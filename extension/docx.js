// Генератор .docx (Office Open XML) без внешних библиотек: заголовки, абзацы, таблицы, картинки PNG.
(function (g) {
  const esc = (s) =>
    String(s == null ? '' : globalThis.QAI18N ? QAI18N.T(String(s)) : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const NS =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  const TEXT_WIDTH = 9922; // twips: A4 минус поля
  const EMU_PER_TWIP = 635;

  class DocxBuilder {
    constructor() {
      this.body = [];
      this.images = [];
    }
    /** text run; o: {bold, italic, color, size(half-points), mono, fill} */
    run(text, o = {}) {
      let rPr = '';
      if (o.mono) rPr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
      if (o.bold) rPr += '<w:b/><w:bCs/>';
      if (o.italic) rPr += '<w:i/><w:iCs/>';
      if (o.color) rPr += `<w:color w:val="${o.color}"/>`;
      if (o.size) rPr += `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>`;
      if (o.fill) rPr += `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`;
      const pr = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
      return String(text == null ? '' : text)
        .split('\n')
        .map((l, i) => `<w:r>${pr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(l)}</w:t></w:r>`)
        .join('');
    }
    pXml(runs, o = {}) {
      let pPr = '';
      if (o.style) pPr += `<w:pStyle w:val="${o.style}"/>`;
      if (o.keepNext) pPr += '<w:keepNext/>';
      if (o.fill) pPr += `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`;
      if (o.after != null || o.before != null) pPr += `<w:spacing${o.before != null ? ` w:before="${o.before}"` : ''}${o.after != null ? ` w:after="${o.after}"` : ''}/>`;
      if (o.indent) pPr += `<w:ind w:left="${o.indent}"/>`;
      if (o.align) pPr += `<w:jc w:val="${o.align}"/>`;
      return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`;
    }
    p(runsOrText, o = {}) {
      const runs = typeof runsOrText === 'string' ? this.run(runsOrText, o.run || {}) : runsOrText.join('');
      this.body.push(this.pXml(runs, o));
      return this;
    }
    title(text) { return this.p(text, { style: 'Title' }); }
    h(text, level = 1) { return this.p(text, { style: 'Heading' + level }); }
    code(text) {
      this.body.push(this.pXml(this.run(text, { mono: true, size: 16 }), { fill: 'F3F4F6', after: 80 }));
      return this;
    }
    pageBreak() { this.body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); return this; }

    /** rows: [[cell...]], cell = string | {text, bold, color, mono, fill}; widths in twips */
    table(rows, { widths, header = true, size = 16 } = {}) {
      if (!rows.length) return this;
      const cols = rows[0].length;
      const ws = widths || Array(cols).fill(Math.floor(TEXT_WIDTH / cols));
      const b = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/>`;
      let x = `<w:tbl><w:tblPr><w:tblW w:w="${ws.reduce((a, c) => a + c, 0)}" w:type="dxa"/>` +
        `<w:tblBorders>${b('top')}${b('left')}${b('bottom')}${b('right')}${b('insideH')}${b('insideV')}</w:tblBorders>` +
        `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
      x += '<w:tblGrid>' + ws.map((w) => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>';
      rows.forEach((row, ri) => {
        const isH = header && ri === 0;
        x += '<w:tr>' + (isH ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
        row.forEach((cell, ci) => {
          const c = typeof cell === 'object' && cell !== null ? cell : { text: cell };
          const fill = isH ? 'F3F4F6' : c.fill;
          x += `<w:tc><w:tcPr><w:tcW w:w="${ws[ci]}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>`;
          x += this.pXml(this.run(c.text, { bold: isH || c.bold, color: c.color, mono: c.mono, size }), { after: 0 });
          x += '</w:tc>';
        });
        x += '</w:tr>';
      });
      x += '</w:tbl>';
      this.body.push(x, this.pXml('', { after: 60 }));
      return this;
    }

    /** PNG bytes + размеры в пикселях */
    image(bytes, wPx, hPx, maxWidthTwips = TEXT_WIDTH) {
      const id = this.images.length + 1;
      const rid = 'rIdImg' + id;
      this.images.push({ name: `image${id}.png`, bytes, rid });
      const maxEmu = maxWidthTwips * EMU_PER_TWIP;
      let cx = Math.round(wPx * 9525);
      let cy = Math.round(hPx * 9525);
      if (cx > maxEmu) { cy = Math.round((cy * maxEmu) / cx); cx = maxEmu; }
      const maxH = 8.5 * 914400; // не выше 8.5 дюйма
      if (cy > maxH) { cx = Math.round((cx * maxH) / cy); cy = maxH; }
      const drawing =
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
        `<wp:docPr id="${id}" name="Picture ${id}"/>` +
        `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
        `<pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      this.body.push(this.pXml(drawing, { after: 120 }));
      return this;
    }

    build() {
      const doc =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${this.body.join('')}` +
        `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>` +
        `</w:body></w:document>`;
      const heading = (id, name, lvl, size, color) =>
        `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
        `<w:pPr><w:keepNext/><w:spacing w:before="${lvl === 0 ? 240 : 160}" w:after="100"/><w:outlineLvl w:val="${lvl}"/></w:pPr>` +
        `<w:rPr><w:b/><w:bCs/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
      const styles =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="${globalThis.QAI18N && QAI18N.lang !== 'ru' ? 'en-GB' : 'ru-RU'}" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
        `<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="111827"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>` +
        heading('Heading1', 'heading 1', 0, 30, 'B91C1C') +
        heading('Heading2', 'heading 2', 1, 25, '1F2937') +
        heading('Heading3', 'heading 3', 2, 22, '374151') +
        `</w:styles>`;
      const ct =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
      const rels =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
      const docRels =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        this.images.map((im) => `<Relationship Id="${im.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.name}"/>`).join('') +
        `</Relationships>`;
      const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      const core =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${esc(this.docTitle || 'Баг-репорт')}</dc:title><dc:creator>QA Bug Recorder</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;

      return g.QAZip.makeZip(
        [
          { name: '[Content_Types].xml', data: ct },
          { name: '_rels/.rels', data: rels },
          { name: 'docProps/core.xml', data: core },
          { name: 'word/document.xml', data: doc },
          { name: 'word/styles.xml', data: styles },
          { name: 'word/_rels/document.xml.rels', data: docRels },
          ...this.images.map((im) => ({ name: 'word/media/' + im.name, data: im.bytes })),
        ],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    }
  }

  g.DocxBuilder = DocxBuilder;
  g.DOCX_TEXT_WIDTH = TEXT_WIDTH;
})(typeof window !== 'undefined' ? window : globalThis);
