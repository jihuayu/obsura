import obscura from '../index.js'

const { fetch } = obscura

const page = await fetch('https://www.cac.gov.cn/2018-08/02/c_1123212596.htm', {
  waitUntil: 'domcontentloaded',
  contentSelector: '#BodyLabel',
  includeMarkdown: true,
  includeText: true,
})

console.log(page.markdown)
