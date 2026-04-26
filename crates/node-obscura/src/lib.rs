#![allow(non_snake_case)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Instant;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi::{Env, JsFunction, JsString, Task};
use napi_derive::napi;
use obscura_browser::lifecycle::WaitUntil;
use obscura_browser::{BrowserContext, Page};
use obscura_dom::{DomTree, NodeData, NodeId};
use serde_json::json;
use tokio::sync::mpsc;
use tokio::time::{sleep, timeout, Duration};

const CDP_TRANSPORT_CLOSE_SENTINEL: &str = "__OBSCURA_CDP_TRANSPORT_CLOSED__";

#[derive(Clone)]
#[napi(object)]
pub struct FetchOptions {
    pub waitUntil: Option<String>,
    pub selector: Option<String>,
    pub timeoutMs: Option<u32>,
    pub userAgent: Option<String>,
    pub proxy: Option<String>,
    pub stealth: Option<bool>,
    pub eval: Option<String>,
    pub includeText: Option<bool>,
    pub includeLinks: Option<bool>,
    pub includeMarkdown: Option<bool>,
    pub contentSelector: Option<String>,
}

#[derive(Clone)]
#[napi(object)]
pub struct PuppeteerTransportOptions {
    pub proxy: Option<String>,
    pub stealth: Option<bool>,
    pub userAgent: Option<String>,
}

enum NativeCdpCommand {
    Send(String),
    Close,
}

#[napi]
pub struct NativeCdpSession {
    command_tx: mpsc::UnboundedSender<NativeCdpCommand>,
    closed: Arc<AtomicBool>,
    join_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

#[napi]
impl NativeCdpSession {
    #[napi(constructor)]
    pub fn new(options: Option<PuppeteerTransportOptions>, callback: JsFunction) -> Result<Self> {
        let options = options.unwrap_or_default();
        let (command_tx, command_rx) = mpsc::unbounded_channel::<NativeCdpCommand>();
        let closed = Arc::new(AtomicBool::new(false));
        let thread_closed = closed.clone();
        let callback_tsfn: ThreadsafeFunction<String, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(
                0,
                |ctx: ThreadSafeCallContext<String>| -> Result<Vec<JsString>> {
                    Ok(vec![ctx.env.create_string(&ctx.value)?])
                },
            )?;

        let join_handle = std::thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = callback_tsfn.call(
                        format!("{{\"error\":\"failed to create CDP runtime: {}\"}}", error),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                    return;
                }
            };
            let local = tokio::task::LocalSet::new();
            runtime.block_on(local.run_until(run_native_cdp_session(
                command_rx,
                options,
                callback_tsfn,
                thread_closed,
            )));
        });

        Ok(Self {
            command_tx,
            closed,
            join_handle: Arc::new(Mutex::new(Some(join_handle))),
        })
    }

    #[napi]
    pub fn send(&self, message: String) -> Result<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(js_error("CDP session is closed"));
        }

        self.command_tx
            .send(NativeCdpCommand::Send(message))
            .map_err(|_| js_error("CDP session is closed"))
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        self.close_inner();
        Ok(())
    }
}

impl NativeCdpSession {
    fn close_inner(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }

        let _ = self.command_tx.send(NativeCdpCommand::Close);

        if let Ok(mut join_handle) = self.join_handle.lock() {
            if let Some(handle) = join_handle.take() {
                let _ = handle.join();
            }
        }
    }
}

impl Drop for NativeCdpSession {
    fn drop(&mut self) {
        self.close_inner();
    }
}

impl Default for PuppeteerTransportOptions {
    fn default() -> Self {
        Self {
            proxy: None,
            stealth: None,
            userAgent: None,
        }
    }
}

async fn run_native_cdp_session(
    mut command_rx: mpsc::UnboundedReceiver<NativeCdpCommand>,
    options: PuppeteerTransportOptions,
    callback: ThreadsafeFunction<String, ErrorStrategy::Fatal>,
    closed: Arc<AtomicBool>,
) {
    let (engine, receiver) = obscura_cdp::engine_channel();
    let (reply_tx, mut reply_rx) = mpsc::unbounded_channel::<String>();
    let engine_options = obscura_cdp::CdpEngineOptions {
        proxy: options.proxy,
        stealth: options.stealth.unwrap_or(false),
        user_agent: options.userAgent,
    };
    let engine_task = tokio::task::spawn_local(obscura_cdp::run_engine(receiver, engine_options));
    let _ = engine.new_connection(reply_tx.clone());

    loop {
        tokio::select! {
            Some(command) = command_rx.recv() => {
                match command {
                    NativeCdpCommand::Send(message) => {
                        let _ = engine.send_cdp(message, reply_tx.clone());
                    }
                    NativeCdpCommand::Close => break,
                }
            }
            Some(message) = reply_rx.recv() => {
                if !message.contains("\"__init\"") {
                    let _ = callback.call(message, ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
            else => break,
        }
    }

    engine.shutdown();
    engine_task.abort();
    closed.store(true, Ordering::SeqCst);
    let _ = callback.call(
        CDP_TRANSPORT_CLOSE_SENTINEL.to_string(),
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

#[napi]
pub fn fetch(url: String, options: Option<FetchOptions>) -> AsyncTask<FetchTask> {
    AsyncTask::new(FetchTask {
        url,
        options: options.unwrap_or_default(),
    })
}

pub struct FetchTask {
    url: String,
    options: FetchOptions,
}

impl Task for FetchTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        let timeout_ms = self.options.timeoutMs.unwrap_or(30_000).max(1);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| js_error(format!("failed to create runtime: {}", error)))?;

        let value =
            runtime.block_on(fetch_inner(self.url.clone(), self.options.clone(), timeout_ms))?;

        serde_json::to_string(&value)
            .map_err(|error| js_error(format!("failed to serialize fetch result: {}", error)))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

async fn fetch_inner(
    url: String,
    options: FetchOptions,
    timeout_ms: u32,
) -> Result<serde_json::Value> {
    let started = Instant::now();
    let wait_until = WaitUntil::from_str(options.waitUntil.as_deref().unwrap_or("load"));
    let stealth = options.stealth.unwrap_or(false);

    let context = Arc::new(BrowserContext::with_options(
        "node-fetch".to_string(),
        options.proxy.clone(),
        stealth,
    ));
    let mut page = Page::new("node-fetch-page".to_string(), context);

    if let Some(user_agent) = options.userAgent.as_deref() {
        page.http_client.set_user_agent(user_agent).await;
    }

    match timeout(
        Duration::from_millis(timeout_ms as u64),
        page.navigate_with_wait(&url, wait_until),
    )
    .await
    {
        Ok(result) => {
            result.map_err(|error| js_error(format!("failed to navigate to {}: {}", url, error)))?
        }
        Err(_) => {
            return Err(js_error(format!(
                "navigation timeout after {}ms",
                timeout_ms
            )));
        }
    }

    if let Some(selector) = options.selector.as_deref() {
        let found = wait_for_selector(&page, selector, Duration::from_millis(timeout_ms as u64))
            .await;
        if !found {
            return Err(js_error(format!(
                "selector timeout after {}ms: {}",
                timeout_ms, selector
            )));
        }
    }

    let html = extract_html(&page);
    let text = if options.includeText.unwrap_or(false) {
        extract_text(&page)
    } else {
        None
    };
    let links = if options.includeLinks.unwrap_or(false) {
        extract_links(&page)
    } else {
        None
    };
    let markdown = if options.includeMarkdown.unwrap_or(false) {
        extract_markdown(&page, options.contentSelector.as_deref())
    } else {
        None
    };
    let eval = if let Some(expression) = options.eval.as_deref() {
        Some(
            page.evaluate_result(expression)
                .map_err(|error| js_error(format!("eval failed: {}", error)))?,
        )
    } else {
        None
    };

    let status = page
        .network_events
        .iter()
        .find(|event| event.resource_type == "Document")
        .map(|event| event.status);

    let mut result = json!({
        "url": url,
        "finalUrl": page.url_string(),
        "title": page.title,
        "html": html,
        "timing": {
            "totalMs": started.elapsed().as_millis() as u64
        }
    });

    if let Some(status) = status {
        result["status"] = json!(status);
    }
    if let Some(text) = text {
        result["text"] = json!(text);
    }
    if let Some(links) = links {
        result["links"] = json!(links);
    }
    if let Some(markdown) = markdown {
        result["markdown"] = json!(markdown);
    }
    if let Some(eval) = eval {
        result["eval"] = eval;
    }

    Ok(result)
}

impl Default for FetchOptions {
    fn default() -> Self {
        Self {
            waitUntil: None,
            selector: None,
            timeoutMs: None,
            userAgent: None,
            proxy: None,
            stealth: None,
            eval: None,
            includeText: None,
            includeLinks: None,
            includeMarkdown: None,
            contentSelector: None,
        }
    }
}

fn js_error(message: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, message.into())
}

async fn wait_for_selector(page: &Page, selector: &str, timeout_duration: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout_duration;

    loop {
        let found = page
            .with_dom(|dom| dom.query_selector(selector).ok().flatten().is_some())
            .unwrap_or(false);

        if found {
            return true;
        }

        if tokio::time::Instant::now() >= deadline {
            return false;
        }

        sleep(Duration::from_millis(100)).await;
    }
}

fn extract_html(page: &Page) -> String {
    page.with_dom(|dom| {
        if let Ok(Some(html_node)) = dom.query_selector("html") {
            format!("<!DOCTYPE html>\n{}", dom.outer_html(html_node))
        } else {
            let doc = dom.document();
            dom.inner_html(doc)
        }
    })
    .unwrap_or_default()
}

fn extract_text(page: &Page) -> Option<String> {
    page.with_dom(|dom| {
        dom.query_selector("body")
            .ok()
            .flatten()
            .map(|body| extract_readable_text(dom, body).trim().to_string())
    })
    .flatten()
}

fn extract_links(page: &Page) -> Option<Vec<serde_json::Value>> {
    page.with_dom(|dom| {
        let base_url = page.url.clone();
        dom.query_selector_all("a")
            .unwrap_or_default()
            .into_iter()
            .filter_map(|link_id| {
                let node = dom.get_node(link_id)?;
                let href = node.get_attribute("href").unwrap_or_default().to_string();
                if href.is_empty() {
                    return None;
                }

                let url = if href.starts_with("http://") || href.starts_with("https://") {
                    href
                } else if let Some(ref base) = base_url {
                    base.join(&href)
                        .map(|url| url.to_string())
                        .unwrap_or(href)
                } else {
                    href
                };

                Some(json!({
                    "url": url,
                    "text": dom.text_content(link_id).trim()
                }))
            })
            .collect()
    })
}

fn extract_markdown(page: &Page, selector: Option<&str>) -> Option<String> {
    page.with_dom(|dom| {
        let root = selector
            .and_then(|selector| dom.query_selector(selector).ok().flatten())
            .or_else(|| dom.query_selector("body").ok().flatten())
            .unwrap_or_else(|| dom.document());

        normalize_markdown(&dom_to_markdown(dom, root, page.url.as_ref()))
    })
}

fn normalize_markdown(markdown: &str) -> String {
    let mut normalized = markdown
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");

    while normalized.contains("\n\n\n") {
        normalized = normalized.replace("\n\n\n", "\n\n");
    }

    normalized.trim().to_string()
}

fn dom_to_markdown(dom: &DomTree, node_id: NodeId, base_url: Option<&url::Url>) -> String {
    let node = match dom.get_node(node_id) {
        Some(node) => node,
        None => return String::new(),
    };

    match &node.data {
        NodeData::Text { contents } => contents.trim().to_string(),
        NodeData::Element { name, .. } => {
            let tag = name.local.as_ref();
            if matches!(tag, "script" | "style" | "noscript" | "link" | "meta") {
                return String::new();
            }

            let children = dom
                .children(node_id)
                .into_iter()
                .map(|child_id| dom_to_markdown(dom, child_id, base_url))
                .collect::<Vec<_>>()
                .join("");
            let trimmed = children.trim();

            match tag {
                "h1" => format!("\n# {}\n\n", trimmed),
                "h2" => format!("\n## {}\n\n", trimmed),
                "h3" => format!("\n### {}\n\n", trimmed),
                "h4" => format!("\n#### {}\n\n", trimmed),
                "h5" => format!("\n##### {}\n\n", trimmed),
                "h6" => format!("\n###### {}\n\n", trimmed),
                "p" => format!("\n{}\n\n", trimmed),
                "br" => "\n".to_string(),
                "hr" => "\n---\n\n".to_string(),
                "strong" | "b" => format!("**{}**", children),
                "em" | "i" => format!("*{}*", children),
                "code" => format!("`{}`", children),
                "pre" => format!("\n```\n{}\n```\n\n", children),
                "blockquote" => format!("\n> {}\n\n", trimmed.replace('\n', "\n> ")),
                "a" => {
                    let href = absolutize_url(node.get_attribute("href").unwrap_or_default(), base_url);
                    if href.is_empty() || trimmed.is_empty() {
                        children
                    } else {
                        format!("[{}]({})", trimmed, href)
                    }
                }
                "img" => {
                    let src = absolutize_url(node.get_attribute("src").unwrap_or_default(), base_url);
                    let alt = node.get_attribute("alt").unwrap_or_default();
                    if src.is_empty() {
                        String::new()
                    } else {
                        format!("![{}]({})", alt, src)
                    }
                }
                "ul" | "ol" => format!("\n{}\n", children),
                "li" => format!("- {}\n", trimmed),
                "tr" => {
                    let cells = dom
                        .children(node_id)
                        .into_iter()
                        .filter_map(|child_id| {
                            let child = dom.get_node(child_id)?;
                            match &child.data {
                                NodeData::Element { name, .. }
                                    if matches!(name.local.as_ref(), "td" | "th") =>
                                {
                                    Some(dom_to_markdown(dom, child_id, base_url).trim().to_string())
                                }
                                _ => None,
                            }
                        })
                        .collect::<Vec<_>>();
                    if cells.is_empty() {
                        children
                    } else {
                        format!("| {} |\n", cells.join(" | "))
                    }
                }
                "table" | "thead" | "tbody" | "tfoot" => format!("\n{}\n", children),
                "div" | "section" | "article" | "main" | "aside" | "nav" | "header"
                | "footer" => format!("\n{}", children),
                _ => children,
            }
        }
        _ => dom
            .children(node_id)
            .into_iter()
            .map(|child_id| dom_to_markdown(dom, child_id, base_url))
            .collect(),
    }
}

fn absolutize_url(value: &str, base_url: Option<&url::Url>) -> String {
    if value.starts_with("http://") || value.starts_with("https://") || value.starts_with("file://")
    {
        value.to_string()
    } else if let Some(base) = base_url {
        base.join(value)
            .map(|url| url.to_string())
            .unwrap_or_else(|_| value.to_string())
    } else {
        value.to_string()
    }
}

fn extract_readable_text(dom: &DomTree, node_id: NodeId) -> String {
    let mut result = String::new();
    let node = match dom.get_node(node_id) {
        Some(node) => node,
        None => return result,
    };

    match &node.data {
        NodeData::Text { contents } => {
            let trimmed = contents.trim();
            if !trimmed.is_empty() {
                result.push_str(trimmed);
            }
        }
        NodeData::Element { name, .. } => {
            let tag = name.local.as_ref();
            let is_block = matches!(
                tag,
                "div"
                    | "p"
                    | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
                    | "li"
                    | "tr"
                    | "br"
                    | "hr"
                    | "blockquote"
                    | "pre"
                    | "section"
                    | "article"
                    | "header"
                    | "footer"
                    | "nav"
                    | "main"
                    | "aside"
                    | "figure"
                    | "figcaption"
                    | "table"
                    | "thead"
                    | "tbody"
                    | "tfoot"
                    | "dl"
                    | "dt"
                    | "dd"
                    | "ul"
                    | "ol"
            );

            if tag == "script" || tag == "style" {
                return result;
            }

            if is_block {
                result.push('\n');
            }

            for child_id in dom.children(node_id) {
                result.push_str(&extract_readable_text(dom, child_id));
            }

            if is_block {
                result.push('\n');
            }
        }
        _ => {
            for child_id in dom.children(node_id) {
                result.push_str(&extract_readable_text(dom, child_id));
            }
        }
    }

    result
}
