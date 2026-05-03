declare module 'officeparser' {
  interface OfficeParserAST {
    toText(): string
    toMarkdown(): string
    content: any[]
    metadata: Record<string, any>
    type: string
  }

  function parseOffice(
    file: string | Buffer | ArrayBuffer,
    config?: Record<string, any>
  ): Promise<OfficeParserAST>

  export default { parseOffice }
}
