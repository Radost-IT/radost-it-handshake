// CloudFront sends the viewer address as `ip:port`; IPv6 addresses contain
// colons too, so only the last part is the port.
export function clientIp(headers: Headers): string {
  const viewerAddress = headers.get('cloudfront-viewer-address');
  if (viewerAddress) return viewerAddress.slice(0, viewerAddress.lastIndexOf(':'));

  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || 'unknown';
}
