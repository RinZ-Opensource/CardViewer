const OFFICIAL_GENERATED_PREFIX = "/official/generated/";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function rawHrefPathname(href: string) {
  const pathAndSuffix = href.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, "");
  if (pathAndSuffix.startsWith("//")) {
    const authorityEnd = pathAndSuffix.indexOf("/", 2);
    return authorityEnd === -1 ? "/" : pathAndSuffix.slice(authorityEnd).split(/[?#]/, 1)[0];
  }
  return pathAndSuffix.split(/[?#]/, 1)[0];
}

function hasSafePathSegments(pathname: string, allowLeadingSlash: boolean) {
  const rawSegments = pathname.split("/");
  if (allowLeadingSlash && rawSegments[0] === "") rawSegments.shift();
  if (!rawSegments.length || rawSegments.some((segment) => !segment)) return false;

  return rawSegments.every((rawSegment) => {
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return false;
    }
    return (
      Boolean(segment) &&
      !segment.startsWith(".") &&
      !segment.includes("/") &&
      !segment.includes("\\") &&
      !segment.includes("%") &&
      !segment.includes("?") &&
      !segment.includes("#") &&
      !CONTROL_CHARACTERS.test(segment)
    );
  });
}

/**
 * Resolve a shard declared by the online manifest without allowing the index
 * to turn the browser into a cross-origin fetcher or escape the reviewed R2
 * route. Raw segments are checked before URL normalization so `..` and encoded
 * traversal cannot disappear during resolution.
 */
export function resolveManifestShardUrl(href: string, manifestUrl: string, pageHref: string) {
  const rawPathname = rawHrefPathname(href);
  if (!href || !hasSafePathSegments(rawPathname, rawPathname.startsWith("/"))) {
    throw new Error(`Unsafe manifest shard URL: ${href}`);
  }

  let pageUrl: URL;
  let shardUrl: URL;
  try {
    pageUrl = new URL(pageHref);
    shardUrl = new URL(href, new URL(manifestUrl, pageUrl));
  } catch {
    throw new Error(`Unsafe manifest shard URL: ${href}`);
  }

  if (
    shardUrl.origin !== pageUrl.origin ||
    !shardUrl.pathname.startsWith(OFFICIAL_GENERATED_PREFIX) ||
    !hasSafePathSegments(shardUrl.pathname, true)
  ) {
    throw new Error(`Unsafe manifest shard URL: ${href}`);
  }

  return shardUrl.toString();
}
