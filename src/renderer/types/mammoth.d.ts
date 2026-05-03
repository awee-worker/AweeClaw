declare module 'mammoth/mammoth.browser.min.js' {
  interface Result {
    value: string
    messages: any[]
  }

  interface ConvertOptions {
    arrayBuffer?: ArrayBuffer
    styleMap?: string[]
    convertImage?: any
  }

  function convertToHtml(options: ConvertOptions): Promise<Result>
  function extractRawText(options: ConvertOptions): Promise<Result>
  function convertToMarkdown(options: ConvertOptions): Promise<Result>

  export { convertToHtml, extractRawText, convertToMarkdown }
  export default { convertToHtml, extractRawText, convertToMarkdown }
}
