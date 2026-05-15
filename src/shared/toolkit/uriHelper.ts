const FILE_PROTOCOL = 'file://'
const FILE_PROTOCOL_SLASHED = 'file:///'
const WINDOWS_DRIVE_REGEX = /^[a-zA-Z]:/

export function pathToLspUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (WINDOWS_DRIVE_REGEX.test(normalized)) {
    return `${FILE_PROTOCOL_SLASHED}${normalized}`
  }
  return `${FILE_PROTOCOL}${normalized}`
}

export function lspUriToPath(uri: string): string {
  let result = uri

  if (result.startsWith(FILE_PROTOCOL_SLASHED)) {
    result = result.slice(FILE_PROTOCOL_SLASHED.length)
    if (!WINDOWS_DRIVE_REGEX.test(result)) {
      result = `/${result}`
    }
  } else if (result.startsWith(FILE_PROTOCOL)) {
    result = result.slice(FILE_PROTOCOL.length)
  }

  try { result = decodeURIComponent(result) } catch { /* keep as-is */ }

  if (WINDOWS_DRIVE_REGEX.test(result)) {
    result = result.replace(/\//g, '\\')
  }

  return result
}

export function normalizeLspUri(uri: string): string {
  if (!uri) return uri

  try {
    let decoded = decodeURIComponent(uri)

    if (decoded.startsWith(FILE_PROTOCOL_SLASHED)) {
      const pathSegment = decoded.slice(FILE_PROTOCOL_SLASHED.length)
      if (/^[a-z]:/.test(pathSegment)) {
        decoded = `${FILE_PROTOCOL_SLASHED}${pathSegment[0].toUpperCase()}${pathSegment.slice(1)}`
      } else {
        decoded = `${FILE_PROTOCOL_SLASHED}${pathSegment}`
      }
    } else if (decoded.startsWith(FILE_PROTOCOL)) {
      decoded = `${FILE_PROTOCOL_SLASHED}${decoded.slice(FILE_PROTOCOL.length)}`
    }

    return decoded
  } catch {
    return uri
  }
}

export function isFileUri(uri: string): boolean {
  return uri.startsWith(FILE_PROTOCOL)
}

export function extractAuthority(uri: string): string | null {
  const match = uri.match(/^(\w+):\/\/([^/]+)/)
  return match ? match[2] : null
}

export function buildFileUri(segments: string[]): string {
  const joined = segments.join('/').replace(/\\/g, '/')
  return pathToLspUri(joined)
}
