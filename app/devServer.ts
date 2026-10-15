// The developer is whoever runs the dev server: only there is the game's base
// content, committed under app/assets, written.
export const isDevServer = () => process.env.NODE_ENV === 'development'
