const SITE_URL = 'https://handshake.radostit.com';
const COMPANY_URL = 'https://radostit.com';
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif";
const MONO_FONT = "'SFMono-Regular', Menlo, Consolas, monospace";
const LINK_STYLE = 'color:#0b7d96;text-decoration:underline';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type EmailBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; label: string; code: string }
  | { kind: 'snippet'; label: string; text: string }
  | { kind: 'button'; label: string; href: string };

function paragraph(text: string, style = ''): string {
  return `<p style="font-family:${FONT};font-size:14px;line-height:24px;color:#333333;margin:0 0 16px;${style}">${escapeHtml(text)}</p>`;
}

function renderBlock(block: EmailBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return paragraph(block.text);
    case 'code':
      return `${paragraph(block.label, 'font-weight:bold;text-align:center;margin:8px 0 0')}
<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:10px auto 16px">
  <tr><td style="background-color:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:12px 20px;font-family:${MONO_FONT};font-size:36px;line-height:40px;letter-spacing:6px;font-weight:bold;color:#333333;text-align:center;-webkit-user-select:all;user-select:all">${escapeHtml(block.code)}</td></tr>
</table>`;
    case 'snippet':
      return `${paragraph(block.label, 'font-weight:bold;margin:0 0 6px')}
<div style="background-color:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:10px 14px;margin:0 0 16px;font-family:${MONO_FONT};font-size:13px;line-height:20px;color:#333333;white-space:pre-wrap;word-break:break-word">${escapeHtml(block.text)}</div>`;
    case 'button':
      return `<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px auto 16px">
  <tr><td style="background-color:#0b7d96;border-radius:999px"><a href="${escapeHtml(block.href)}" target="_blank" style="display:inline-block;padding:10px 24px;font-family:${FONT};font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">${escapeHtml(block.label)}</a></td></tr>
</table>`;
  }
}

/**
 * Wraps the blocks in the same card layout as the Radost IT product emails:
 * logo, heading, body, a security note and the company footer. All text is
 * escaped, because some of it (an email address, a reason) comes from visitors.
 */
export function renderEmailHtml(email: {
  preview: string;
  heading: string;
  blocks: readonly EmailBlock[];
  note: string;
}): string {
  return `<!DOCTYPE html>
<html dir="ltr" lang="en">
<head><meta content="text/html; charset=UTF-8" http-equiv="Content-Type" /></head>
<body style="background-color:#ffffff;color:#212121;margin:0">
<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">${escapeHtml(email.preview)}</div>
<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:37.5em;padding:20px;margin:0 auto;background-color:#f8f8f8">
  <tr><td>
    <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff">
      <tr><td align="center" style="padding:24px 0 4px"><img alt="Handshake by Radost IT" src="${SITE_URL}/logo.png" width="96" height="96" style="display:block;border:none;outline:none;text-decoration:none;border-radius:16px" /></td></tr>
      <tr><td style="padding:20px 35px 8px">
        <h1 style="font-family:${FONT};font-size:20px;font-weight:bold;color:#333333;margin:0 0 16px">${escapeHtml(email.heading)}</h1>
        ${email.blocks.map(renderBlock).join('\n        ')}
      </td></tr>
      <tr><td style="padding:0 35px"><hr style="width:100%;border:none;border-top:1px solid #eaeaea;margin:0" /></td></tr>
      <tr><td style="padding:20px 35px 8px">
        ${paragraph(email.note)}
        <p style="font-family:${FONT};font-size:14px;line-height:24px;color:#333333;margin:0 0 16px">Questions? <a href="${SITE_URL}/contact" target="_blank" style="${LINK_STYLE}">Contact us</a>.</p>
      </td></tr>
    </table>
    <p style="font-family:${FONT};font-size:12px;line-height:24px;color:#333333;margin:24px 0 4px">Handshake by Radost IT. PayPal sandbox only, no real money moves.</p>
    <p style="font-family:${FONT};font-size:12px;line-height:24px;color:#333333;margin:0"><a href="${SITE_URL}" target="_blank" style="${LINK_STYLE}">Visit Handshake</a>. <a href="${COMPANY_URL}/privacy" target="_blank" style="${LINK_STYLE}">Privacy policy</a>.</p>
  </td></tr>
</table>
</body>
</html>`;
}
