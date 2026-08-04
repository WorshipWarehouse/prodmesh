// The build-time help module (see vite-plugin-help.ts). Declared so the app
// can import documentation that does not exist as a file on disk.
declare module 'virtual:help-content' {
  interface HelpPage {
    slug: string;
    title: string;
    html: string;
    text: string;
  }
  const pages: HelpPage[];
  export default pages;
}
