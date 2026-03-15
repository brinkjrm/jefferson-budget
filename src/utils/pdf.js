import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const fmt = (n) => {
  if (!n && n !== 0) return '$-'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export async function generateDrawPDF(draw, items, settings) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 45
  let y = margin

  // ── Header bar ──────────────────────────────────────────────────────────
  doc.setFillColor(30, 78, 121)
  doc.rect(margin, y, W - margin * 2, 28, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(255, 255, 255)
  doc.text('REQUEST FOR PARTIAL DISBURSEMENT OF LOAN PROCEEDS', W / 2, y + 18, { align: 'center' })
  y += 38

  // ── Info grid ────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(0, 0, 0)

  const leftCol = margin
  const rightCol = W / 2 + 10
  const lineH = 16

  const infoLeft = [
    ['Borrower:', draw.borrower || settings.borrower],
    ['Property:', draw.property_address || settings.property_address],
    ['Builder:', draw.builder || settings.builder],
    ['Bank:', draw.bank_name || settings.bank_name],
  ]
  const infoRight = [
    ['Draw #:', String(draw.draw_number)],
    ['Date:', draw.draw_date ? new Date(draw.draw_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''],
    ['Loan #:', draw.loan_number || ''],
    ['Loan Amount:', fmt(draw.loan_amount)],
  ]

  const infoStart = y
  infoLeft.forEach(([label, val], i) => {
    doc.setFont('helvetica', 'bold'); doc.text(label, leftCol, infoStart + i * lineH)
    doc.setFont('helvetica', 'normal'); doc.text(val || '', leftCol + 65, infoStart + i * lineH)
  })
  infoRight.forEach(([label, val], i) => {
    doc.setFont('helvetica', 'bold'); doc.text(label, rightCol, infoStart + i * lineH)
    doc.setFont('helvetica', 'normal'); doc.text(val || '', rightCol + 70, infoStart + i * lineH)
  })
  y = infoStart + infoLeft.length * lineH + 10

  // ── Legal text ───────────────────────────────────────────────────────────
  doc.setDrawColor(180, 180, 180)
  doc.line(margin, y, W - margin, y)
  y += 10
  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  const bank = draw.bank_name || settings.bank_name || 'the Bank'
  const legalText = `Pursuant to the Construction/Building Agreement, the undersigned hereby requests that ${bank} pay the following amounts representing labor used on and material delivered to the job site at: ${draw.property_address || settings.property_address}, for all work performed as itemized below.`
  const legalLines = doc.splitTextToSize(legalText, W - margin * 2)
  doc.text(legalLines, margin, y)
  y += legalLines.length * 11 + 8
  doc.line(margin, y, W - margin, y)
  y += 12

  // ── Line items table ─────────────────────────────────────────────────────
  const tableBody = items.map((item, i) => [
    i + 1,
    item.description || '',
    fmt(item.previous_amount),
    fmt(item.this_draw_amount),
    fmt((Number(item.previous_amount) || 0) + (Number(item.this_draw_amount) || 0)),
    item.invoice_filename ? '✓' : ''
  ])

  const prevTotal = items.reduce((s, i) => s + (Number(i.previous_amount) || 0), 0)
  const thisTotal = items.reduce((s, i) => s + (Number(i.this_draw_amount) || 0), 0)
  const grandTotal = prevTotal + thisTotal

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['#', 'Description', 'Previous Draws', 'This Draw', 'Total to Date', 'Invoice']],
    body: tableBody,
    foot: [['', 'TOTALS', fmt(prevTotal), fmt(thisTotal), fmt(grandTotal), '']],
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 78, 121], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [220, 220, 220], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      2: { halign: 'right', cellWidth: 80 },
      3: { halign: 'right', cellWidth: 75 },
      4: { halign: 'right', cellWidth: 80 },
      5: { halign: 'center', cellWidth: 45 },
    },
    alternateRowStyles: { fillColor: [248, 248, 248] },
  })

  y = doc.lastAutoTable.finalY + 16

  // ── Summary box ──────────────────────────────────────────────────────────
  const remaining = (Number(draw.loan_amount) || 0) - grandTotal
  const summaryRows = [
    ['Loan Amount:', fmt(draw.loan_amount)],
    ['Previous Draws:', fmt(prevTotal)],
    ['This Draw Request:', fmt(thisTotal)],
    ['Total Disbursed:', fmt(grandTotal)],
    ['$ Remaining:', fmt(remaining)],
  ]

  const boxX = W - margin - 200
  const boxW = 200
  doc.setDrawColor(30, 78, 121)
  doc.setLineWidth(0.5)
  doc.rect(boxX, y, boxW, summaryRows.length * 16 + 10)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setFillColor(30, 78, 121)
  doc.rect(boxX, y, boxW, 14, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text('DRAW SUMMARY', boxX + boxW / 2, y + 9.5, { align: 'center' })
  doc.setTextColor(0, 0, 0)

  summaryRows.forEach(([label, val], i) => {
    const ry = y + 14 + i * 16 + 11
    const isRemainingRow = i === summaryRows.length - 1
    if (isRemainingRow) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(remaining < 0 ? 200 : 0, 0, 0)
    } else {
      doc.setFont('helvetica', i === 3 ? 'bold' : 'normal')
    }
    doc.text(label, boxX + 8, ry)
    doc.text(val, boxX + boxW - 8, ry, { align: 'right' })
  })
  doc.setTextColor(0, 0, 0)

  // ── Signature block ──────────────────────────────────────────────────────
  const sigY = Math.max(y + summaryRows.length * 16 + 20, doc.lastAutoTable ? doc.lastAutoTable.finalY + 100 : y + 120)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.line(margin, sigY, margin + 200, sigY)
  doc.text('Mortgagor / Authorized Signature', margin, sigY + 11)
  doc.line(margin + 260, sigY, margin + 380, sigY)
  doc.text('Date', margin + 260, sigY + 11)
  y = sigY + 30

  // ── Bank Use Only ────────────────────────────────────────────────────────
  doc.setDrawColor(100, 100, 100)
  doc.setFillColor(245, 245, 245)
  doc.rect(margin, y, W - margin * 2, 70, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('BANK USE ONLY', margin + 8, y + 12)
  doc.setFont('helvetica', 'normal')
  doc.text('Approved for Payment: _________________________', margin + 8, y + 26)
  doc.text('CHECK #: ___________________', margin + 8, y + 40)
  doc.text('ACH: ___________________', margin + 180, y + 40)
  doc.text('Payment 1: $___________________', margin + 8, y + 54)
  doc.text('Payment 2: $___________________', margin + 180, y + 54)
  doc.text(`Authorized Signature: _________________________    Date: ___________`, W - margin - 300, y + 26)

  // ── Invoice images on subsequent pages ──────────────────────────────────
  const itemsWithImages = items.filter(item => item.invoice_url)
  for (const item of itemsWithImages) {
    try {
      const imgData = await fetchImageAsDataURL(item.invoice_url)
      if (imgData) {
        doc.addPage()
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.text(`Invoice: ${item.description}`, margin, 60)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.text(`Draw #${draw.draw_number}  ·  Amount: ${fmt(item.this_draw_amount)}`, margin, 78)
        doc.addImage(imgData, 'JPEG', margin, 95, W - margin * 2, 0, undefined, 'FAST')
      }
    } catch (e) {
      console.warn('Could not embed image for', item.description, e)
    }
  }

  doc.save(`Draw_${draw.draw_number}_${(draw.property_address || '').replace(/[^a-z0-9]/gi, '_')}.pdf`)
}

async function fetchImageAsDataURL(url) {
  const response = await fetch(url)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
