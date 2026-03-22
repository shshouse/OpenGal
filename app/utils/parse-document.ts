export async function parseDocument(file: File): Promise<{ text: string; fileName: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  let text = ''

  if (ext === 'txt') {
    text = await file.text()
  } else if (ext === 'pdf') {
    const pdfjsLib = await import('pdfjs-dist')
    const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((item: any) => item.str).join(' '))
    }
    text = pages.join('\n')
  } else if (ext === 'docx' || ext === 'doc') {
    const mammoth = await import('mammoth')
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.default.extractRawText({ arrayBuffer })
    text = result.value
  } else {
    throw new Error('不支持的文件格式，请上传 PDF、Word 或 TXT 文件')
  }

  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (text.length < 10) {
    throw new Error('无法从文件中提取到足够的文本内容')
  }

  return { text, fileName: file.name }
}
