export function relativeSpaBaseHref(requestPath: string): string {
  const routeDepth = requestPath.split("/").filter(Boolean).length;
  return routeDepth === 0 ? "./" : "../".repeat(routeDepth);
}

export function injectSpaBase(html: string, requestPath: string): string {
  return html.replace("<head>", `<head>\n    <base href="${relativeSpaBaseHref(requestPath)}" />`);
}
