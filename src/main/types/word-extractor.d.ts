declare module 'word-extractor' {
  interface ExtractedDoc {
    getBody(): string
    getHeaders(): string[]
    getFooters(): string[]
    getFootnotes(): string[]
    getEndnotes(): string[]
    getAnnotations(): string[]
  }

  class WordExtractor {
    extract(filePath: string): Promise<ExtractedDoc>
  }

  export default WordExtractor
}
