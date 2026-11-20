// 极简 hash 路由
export type PageRenderer = (container: HTMLElement, params: URLSearchParams) => void | (() => void);

class Router {
  private routes = new Map<string, PageRenderer>();
  private currentCleanup: void | (() => void) = undefined;
  private main: HTMLElement | null = null;
  private navLinks: NodeListOf<HTMLAnchorElement> | null = null;

  register(routes: Record<string, PageRenderer>): void {
    this.routes = new Map(Object.entries(routes));
  }

  start(defaultPath: string): void {
    this.main = document.getElementById('app')!;
    this.navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav a');
    window.addEventListener('hashchange', () => this.render());
    if (!location.hash || location.hash === '#/') location.hash = defaultPath;
    this.render();
  }

  private render(): void {
    const hash = location.hash.replace(/^#/, '') || '/library';
    const [path, query] = hash.split('?');
    const renderer = this.routes.get(path) ?? this.routes.get('/library')!;
    if (typeof this.currentCleanup === 'function') this.currentCleanup();
    const main = document.querySelector<HTMLElement>('main')!;
    main.innerHTML = '';
    this.currentCleanup = renderer(main, new URLSearchParams(query ?? ''));
    this.navLinks?.forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#${path}`);
    });
  }

  navigate(path: string): void {
    location.hash = path;
  }
}

export const router = new Router();

export function toast(message: string, type: 'info' | 'error' = 'info'): void {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 2600);
}
