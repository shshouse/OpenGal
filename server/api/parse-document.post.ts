export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event)
  if (!formData || formData.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No file provided' })
  }

  const filePart = formData.find((p) => p.name === 'file')
  if (!filePart || !filePart.data) {
    throw createError({ statusCode: 400, statusMessage: 'No file provided' })
  }

  const fileName = (filePart.filename ?? '').toLowerCase()
  const buffer = filePart.data
  let text = ''

  if (fileName.endsWith('.txt')) {
    text = buffer.toString('utf-8')
  } else if (fileName.endsWith('.pdf')) {
    const pdfParse = (await import('pdf-parse')).default
    const result = await pdfParse(buffer)
    text = result.text
  } else if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    text = result.value
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsupported file type. Please upload PDF, Word (.docx), or TXT files.',
    })
  }

  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (text.length < 10) {
    throw createError({ statusCode: 400, statusMessage: 'Could not extract text from the file.' })
  }

  return {
    text,
    fileName: filePart.filename ?? '',
    charCount: text.length,
  }
})
