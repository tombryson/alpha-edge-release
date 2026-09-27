const IG_SYNC_CONFIG = {
  get SPREADSHEET_ID() { return requiredIGProperty('IG_SPREADSHEET_ID'); },
  SHEET_NAME: 'IG Holdings Staging',
  DRIVE_FOLDER_NAME: 'IG',
  ACCOUNT_NAME: 'Share trading',
  get API_ENDPOINT() { return requiredIGProperty('IG_TERMINAL_API_ENDPOINT'); },
  OPENAI_MODEL: 'gpt-4o',
  MAX_GPT_RETRIES: 3,
  OCR_MIN_TEXT_LENGTH: 500,
  HOLDINGS_HEADER_LABEL: 'Details',
  SUMMARY_HEADER_LABEL: 'Statement Date'
};

function requiredIGProperty(name) {
  const value = String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
  if (!value) throw new Error('Set the ' + name + ' Script Property before running the importer.');
  if (name === 'IG_TERMINAL_API_ENDPOINT' && !/^https:\/\/[^\s/@?#]+(?:\/[\w.-]+)*\/api\/statements\/import$/.test(value)) {
    throw new Error('IG_TERMINAL_API_ENDPOINT must be an HTTPS statement-import URL without credentials or query parameters.');
  }
  return value;
}

function saveIGStatementsToDrive() {
  const query = requiredIGProperty('IG_STATEMENT_GMAIL_QUERY');
  const threads = GmailApp.search(query);
  const folders = DriveApp.getFoldersByName(IG_SYNC_CONFIG.DRIVE_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(IG_SYNC_CONFIG.DRIVE_FOLDER_NAME);

  let savedCount = 0;

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      message.getAttachments().forEach(att => {
        if (!att.getContentType().includes('pdf')) return;
        const fileName = att.getName();
        if (folder.getFilesByName(fileName).hasNext()) return;
        folder.createFile(att);
        savedCount += 1;
      });
    });
  });

  Logger.log('Saved ' + savedCount + ' new IG statement(s) into Drive folder "' + IG_SYNC_CONFIG.DRIVE_FOLDER_NAME + '".');
}

function processLatestIGStatementViaGPT() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in Script Properties.');

  Logger.log('--- IG PROCESS START ---');

  const pdfFile = getLatestPdfInFolder_(IG_SYNC_CONFIG.DRIVE_FOLDER_NAME);
  const statementDate = extractStatementDate_(pdfFile);
  const ocrText = performDriveOcrV3_(pdfFile);

  if (!ocrText || ocrText.length < IG_SYNC_CONFIG.OCR_MIN_TEXT_LENGTH) {
    throw new Error('OCR returned insufficient text.');
  }

  const summary = extractAccountSummary_(ocrText);
  summary.account_name = IG_SYNC_CONFIG.ACCOUNT_NAME;
  summary.statement_date = statementDate.toISOString();
  summary.source_file = pdfFile.getName();
  validateSummary_(summary);

  const holdings = extractHoldingsWithRetries_(ocrText, apiKey);
  const normalisedHoldings = holdings
    .map(normaliseHolding_)
    .filter(isUsableHolding_);

  if (!normalisedHoldings.length) {
    throw new Error('No usable holdings were extracted from the statement.');
  }

  writeToStagingSheet_(IG_SYNC_CONFIG.SPREADSHEET_ID, IG_SYNC_CONFIG.SHEET_NAME, summary, normalisedHoldings);

  Logger.log('Processed file: ' + pdfFile.getName());
  Logger.log('Statement date: ' + summary.statement_date);
  Logger.log('Holdings extracted: ' + normalisedHoldings.length);
  Logger.log('Contains AVM: ' + containsHolding_(normalisedHoldings, 'Advance Metals Limited', 'AVM'));
  Logger.log('--- IG PROCESS COMPLETE ---');

  return {
    file_name: pdfFile.getName(),
    statement_date: summary.statement_date,
    holdings_count: normalisedHoldings.length
  };
}

function processAndSyncIGStatement() {
  Logger.log('--- IG SYNC START ---');

  const payload = buildPayloadFromStagingSheet_(IG_SYNC_CONFIG.SPREADSHEET_ID, IG_SYNC_CONFIG.SHEET_NAME);
  validatePayload_(payload);

  Logger.log('Sync endpoint: ' + IG_SYNC_CONFIG.API_ENDPOINT);
  Logger.log('Statement date: ' + payload.account.statement_date);
  Logger.log('Holdings count: ' + payload.holdings.length);
  Logger.log('Contains AVM: ' + containsHolding_(payload.holdings, 'Advance Metals Limited', 'AVM'));
  Logger.log('First 10 holdings: ' + JSON.stringify(payload.holdings.slice(0, 10).map(h => h.details)));

  const response = UrlFetchApp.fetch(IG_SYNC_CONFIG.API_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify(payload)
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  Logger.log('API response code: ' + code);
  Logger.log('API response body: ' + body);

  if (code !== 201) {
    throw new Error('Backend sync failed. API returned ' + code + ': ' + body);
  }

  Logger.log('--- IG SYNC COMPLETE ---');
  return JSON.parse(body);
}

function runIGStatementPipeline() {
  saveIGStatementsToDrive();
  processLatestIGStatementViaGPT();
  return processAndSyncIGStatement();
}

function buildPayloadFromStagingSheet_(spreadsheetId, sheetName) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet "' + sheetName + '" not found.');

  const data = sheet.getDataRange().getValues();
  if (!data.length) throw new Error('Staging sheet is empty.');

  const summaryHeaderIndex = findRowIndex_(data, row => String(row[0] || '').trim() === IG_SYNC_CONFIG.SUMMARY_HEADER_LABEL);
  if (summaryHeaderIndex === -1) throw new Error('Could not find summary header row.');
  const summaryHeaders = data[summaryHeaderIndex].map(v => String(v || '').trim());
  const summaryValues = data[summaryHeaderIndex + 1] || [];

  const readSummary = header => summaryValues[summaryHeaders.indexOf(header)];

  const holdingsHeaderIndex = findRowIndex_(data, row => String(row[0] || '').trim() === IG_SYNC_CONFIG.HOLDINGS_HEADER_LABEL);
  if (holdingsHeaderIndex === -1) throw new Error('Could not find holdings header row.');
  const holdingsHeaders = data[holdingsHeaderIndex].map(v => String(v || '').trim());

  const payload = {
    account: {
      account_name: IG_SYNC_CONFIG.ACCOUNT_NAME,
      statement_date: normaliseDateString_(readSummary('Statement Date')),
      usd_value: cleanNum_(readSummary('USD Value')),
      usd_aud: cleanNum_(readSummary('USD (AUD Equiv)')),
      gbp_value: cleanNum_(readSummary('GBP Value')),
      gbp_aud: cleanNum_(readSummary('GBP (AUD Equiv)')),
      aud_value: cleanNum_(readSummary('AUD Assets')),
      cash_aud: cleanNum_(readSummary('Cash (AUD)')),
      total_value_aud: cleanNum_(readSummary('Total Account (AUD)'))
    },
    holdings: []
  };

  for (let i = holdingsHeaderIndex + 1; i < data.length; i++) {
    const row = data[i];
    const details = String(row[holdingsHeaders.indexOf('Details')] || '').trim();
    if (!details) continue;

    const holding = {
      details: details,
      isin: String(row[holdingsHeaders.indexOf('ISIN')] || '').trim(),
      quantity: cleanNum_(row[holdingsHeaders.indexOf('Quantity')]),
      currency: String(row[holdingsHeaders.indexOf('Currency')] || 'AUD').trim() || 'AUD',
      cost_native: cleanNum_(row[holdingsHeaders.indexOf('Cost (Native)')]),
      current_price: cleanNum_(row[holdingsHeaders.indexOf('Current Price')]),
      market_value_native: cleanNum_(row[holdingsHeaders.indexOf('Market Value (Native)')]),
      gain_loss_native: cleanNum_(row[holdingsHeaders.indexOf('Gain/Loss (Native)')]),
      gain_loss_pct: cleanNum_(row[holdingsHeaders.indexOf('Gain/Loss (%)')])
    };

    if (!isUsableHolding_(holding)) continue;
    payload.holdings.push(holding);
  }

  return payload;
}

function writeToStagingSheet_(spreadsheetId, sheetName, summary, holdings) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();

  const summaryHeaders = [[
    'Statement Date',
    'Source File',
    'USD Value',
    'USD (AUD Equiv)',
    'GBP Value',
    'GBP (AUD Equiv)',
    'AUD Assets',
    'Cash (AUD)',
    'Total Account (AUD)'
  ]];

  const summaryRow = [[
    summary.statement_date,
    summary.source_file || '',
    summary.usd_value,
    summary.usd_aud_equiv,
    summary.gbp_value,
    summary.gbp_aud_equiv,
    summary.aud_value,
    summary.cash_aud,
    summary.total_value_aud
  ]];

  const holdingsHeaders = [[
    'Details',
    'ISIN',
    'Quantity',
    'Currency',
    'Cost (Native)',
    'Current Price',
    'Market Value (Native)',
    'Gain/Loss (Native)',
    'Gain/Loss (%)'
  ]];

  sheet.getRange(1, 1).setValue('IG Holdings Staging').setFontWeight('bold');
  sheet.getRange(2, 1, 1, summaryHeaders[0].length).setValues(summaryHeaders).setFontWeight('bold').setBackground('#d9e8fb');
  sheet.getRange(3, 1, 1, summaryRow[0].length).setValues(summaryRow);
  sheet.getRange(5, 1, 1, holdingsHeaders[0].length).setValues(holdingsHeaders).setFontWeight('bold').setBackground('#f3f3f3');

  if (holdings.length) {
    const rows = holdings.map(h => [
      h.details,
      h.isin,
      h.quantity,
      h.currency,
      h.cost_native,
      h.current_price,
      h.market_value_native,
      h.gain_loss_native,
      h.gain_loss_pct
    ]);
    sheet.getRange(6, 1, rows.length, holdingsHeaders[0].length).setValues(rows);
  }

  sheet.autoResizeColumns(1, holdingsHeaders[0].length);
}

function extractHoldingsWithGPT_(ocrText, apiKey) {
  const safeText = ocrText.substring(0, 60000);
  const prompt = [
    'You are parsing an IG trading statement into JSON.',
    'Extract holdings only. Ignore totals, cash, FX summaries, fees, blank rows and subtotal rows.',
    'Use the section header to determine the holding currency, e.g. HOLDINGS AUD, HOLDINGS USD, HOLDINGS GBP.',
    'Return one JSON object with a single key called holdings.',
    'Each holding must contain exactly these lowercase keys:',
    'details, isin, quantity, currency, cost_native, current_price, market_value_native, gain_loss_native, gain_loss_pct.',
    'All numeric fields must be numbers, not strings.',
    'If a field is missing, use 0 for numbers and an empty string for text.',
    'Do not wrap the JSON in markdown.',
    '',
    'OCR text:',
    safeText
  ].join('\n');

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: IG_SYNC_CONFIG.OPENAI_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Return raw JSON only.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code !== 200) {
    throw new Error('OpenAI returned ' + code + ': ' + body);
  }

  const content = JSON.parse(body).choices[0].message.content;
  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed || !parsed.holdings || !parsed.holdings.length) {
    throw new Error('GPT response did not contain a usable holdings array.');
  }

  return parsed.holdings;
}

function extractHoldingsWithRetries_(ocrText, apiKey) {
  let lastError = null;

  for (let attempt = 1; attempt <= IG_SYNC_CONFIG.MAX_GPT_RETRIES; attempt++) {
    try {
      Logger.log('GPT extraction attempt ' + attempt + ' of ' + IG_SYNC_CONFIG.MAX_GPT_RETRIES);
      return extractHoldingsWithGPT_(ocrText, apiKey);
    } catch (err) {
      lastError = err;
      Logger.log('GPT extraction attempt ' + attempt + ' failed: ' + err.message);
      if (attempt < IG_SYNC_CONFIG.MAX_GPT_RETRIES) Utilities.sleep(3000);
    }
  }

  throw lastError || new Error('GPT extraction failed.');
}

function extractAccountSummary_(ocrText) {
  const parseNum = str => cleanNum_(String(str || '').replace(/,/g, ''));
  const grab = regex => {
    const match = ocrText.match(regex);
    return match ? match : null;
  };

  const usd = grab(/Value of USD assets\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/i);
  const gbp = grab(/Value of GBP assets\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/i);
  const aud = grab(/Value of AUD assets\s+([\d,]+\.?\d*)/i);
  const cash = grab(/Cash Balance AUD\s+([\d,]+\.?\d*)/i);
  const total = grab(/Total account value\s+([\d,]+\.?\d*)/i);

  return {
    usd_value: usd ? parseNum(usd[1]) : 0,
    usd_aud_equiv: usd ? parseNum(usd[2]) : 0,
    gbp_value: gbp ? parseNum(gbp[1]) : 0,
    gbp_aud_equiv: gbp ? parseNum(gbp[2]) : 0,
    aud_value: aud ? parseNum(aud[1]) : 0,
    cash_aud: cash ? parseNum(cash[1]) : 0,
    total_value_aud: total ? parseNum(total[1]) : 0
  };
}

function performDriveOcrV3_(pdfFile) {
  const resource = {
    name: 'TEMP_OCR_' + Date.now(),
    mimeType: MimeType.GOOGLE_DOCS
  };

  let tempFile;
  try {
    tempFile = Drive.Files.create(resource, pdfFile.getBlob());
    const doc = DocumentApp.openById(tempFile.id);
    return doc.getBody().getText();
  } finally {
    if (tempFile && tempFile.id) {
      try {
        Drive.Files.remove(tempFile.id);
      } catch (err) {
        Logger.log('Could not delete temporary OCR file: ' + err.message);
      }
    }
  }
}

function getLatestPdfInFolder_(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (!folders.hasNext()) throw new Error('Folder "' + folderName + '" not found.');

  const folder = folders.next();
  const files = folder.getFilesByType(MimeType.PDF);
  let latestFile = null;
  let latestDate = null;

  while (files.hasNext()) {
    const file = files.next();
    const fileDate = extractStatementDate_(file);
    if (!latestDate || fileDate > latestDate) {
      latestDate = fileDate;
      latestFile = file;
    }
  }

  if (!latestFile) throw new Error('No PDF statements found in folder "' + folderName + '".');
  Logger.log('Selected latest PDF: ' + latestFile.getName());
  return latestFile;
}

function extractStatementDate_(file) {
  const name = file.getName();
  const match = name.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/i);
  if (!match) return new Date(file.getLastUpdated());

  const monthMap = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  const day = parseInt(match[1], 10);
  const month = monthMap[match[2].toLowerCase()];
  const year = parseInt(match[3], 10);
  return new Date(Date.UTC(year, month, day, 0, 0, 0));
}

function normaliseHolding_(raw) {
  const get = names => {
    for (let i = 0; i < names.length; i++) {
      const key = names[i];
      if (raw[key] !== undefined && raw[key] !== null) return raw[key];
    }
    return '';
  };

  const details = String(get(['details', 'Details', 'name', 'Name'])).trim();
  const isin = String(get(['isin', 'ISIN'])).trim();
  const currency = String(get(['currency', 'Currency'])).trim().toUpperCase() || 'AUD';

  return {
    details: details,
    isin: isin,
    quantity: cleanNum_(get(['quantity', 'Quantity'])),
    currency: currency,
    cost_native: cleanNum_(get(['cost_native', 'Cost', 'cost', 'CostNative'])),
    current_price: cleanNum_(get(['current_price', 'CurrentPrice', 'price', 'Price'])),
    market_value_native: cleanNum_(get(['market_value_native', 'MarketValue', 'market_value', 'value'])),
    gain_loss_native: cleanNum_(get(['gain_loss_native', 'GainLoss', 'gain_loss'])),
    gain_loss_pct: cleanNum_(get(['gain_loss_pct', 'GainLossPercent', 'gain_loss_percent']))
  };
}

function isUsableHolding_(holding) {
  if (!holding || !holding.details) return false;
  const name = String(holding.details).trim().toLowerCase();
  if (!name || name === 'total') return false;
  if (holding.quantity <= 0 && holding.market_value_native <= 0 && holding.current_price <= 0) return false;
  return true;
}

function containsHolding_(holdings, expectedName, expectedTicker) {
  const targetName = String(expectedName || '').trim().toUpperCase();
  const targetTicker = String(expectedTicker || '').trim().toUpperCase();

  return holdings.some(h => {
    const name = String(h.details || h.name || '').trim().toUpperCase();
    const ticker = String(h.ticker || '').trim().toUpperCase();
    return name === targetName || ticker === targetTicker;
  });
}

function validatePayload_(payload) {
  if (!payload || !payload.account) throw new Error('Payload is missing account data.');
  if (!payload.account.statement_date) throw new Error('Payload is missing statement_date.');
  if (!payload.holdings || !payload.holdings.length) throw new Error('Payload contains no holdings.');

  payload.holdings.forEach((holding, index) => {
    if (!holding.details) throw new Error('Holding #' + (index + 1) + ' is missing details.');
  });
}

function validateSummary_(summary) {
  if (!summary.statement_date) throw new Error('Summary is missing statement date.');
  if (summary.total_value_aud <= 0) {
    throw new Error('Summary total account value is zero. OCR summary extraction likely failed.');
  }
}

function cleanNum_(value) {
  if (value === null || value === undefined || value === '') return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
}

function normaliseDateString_(value) {
  if (!value) return new Date().toISOString();
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
  return new Date(value).toISOString();
}

function findRowIndex_(rows, predicate) {
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i], i)) return i;
  }
  return -1;
}
