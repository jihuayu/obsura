'use strict'

const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { createExports } = require('./lib/create-exports')

const { platform, arch } = process
let nativeBinding = null
let localFileExisted = false
let loadError = null

function loadLocalOrPackage(localFile, packageName) {
  localFileExisted = existsSync(join(__dirname, localFile))
  try {
    if (localFileExisted) {
      return require(join(__dirname, localFile))
    }
    return require(packageName)
  } catch (error) {
    loadError = error
    return null
  }
}

switch (platform) {
  case 'darwin':
    switch (arch) {
      case 'arm64':
        nativeBinding = loadLocalOrPackage(
          'node-obscura.darwin-arm64.node',
          'node-obscura-darwin-arm64'
        )
        break
      case 'x64':
        nativeBinding = loadLocalOrPackage(
          'node-obscura.darwin-x64.node',
          'node-obscura-darwin-x64'
        )
        break
      default:
        throw new Error(`Unsupported architecture on macOS: ${arch}`)
    }
    break
  case 'linux':
    switch (arch) {
      case 'arm64':
        nativeBinding = loadLocalOrPackage(
          'node-obscura.linux-arm64-gnu.node',
          'node-obscura-linux-arm64-gnu'
        )
        break
      case 'x64':
        nativeBinding = loadLocalOrPackage(
          'node-obscura.linux-x64-gnu.node',
          'node-obscura-linux-x64-gnu'
        )
        break
      default:
        throw new Error(`Unsupported architecture on Linux: ${arch}`)
    }
    break
  case 'win32':
    switch (arch) {
      case 'x64':
        nativeBinding = loadLocalOrPackage(
          'node-obscura.win32-x64-msvc.node',
          'node-obscura-win32-x64-msvc'
        )
        break
      default:
        throw new Error(`Unsupported architecture on Windows: ${arch}`)
    }
    break
  default:
    throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`)
}

if (!nativeBinding) {
  if (loadError) {
    throw loadError
  }
  throw new Error('Failed to load native binding')
}

module.exports = createExports(nativeBinding)
