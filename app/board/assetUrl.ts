const BASE = (process.env.NEXT_PUBLIC_ASSET_BASE ?? '').replace(/\/+$/, '')

// Where a stored picture is fetched from. A catalog picture is kept as a path
// under `public/` and is served from the asset host; a full address (a picture
// a player hosts) is used as it is.
export function assetUrl(src: string): string {
  if (!src || /^(https?:)?\/\//.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src
  return `${BASE}${src.startsWith('/') ? '' : '/'}${src}`
}
