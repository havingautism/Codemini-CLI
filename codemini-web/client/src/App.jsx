import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter
} from '@tanstack/react-router';
import {
  Bot,
  ChevronDown,
  Clock3,
  Folder,
  Grid2X2,
  MoreHorizontal,
  Search,
  Settings,
  SunMoon,
  Upload,
  ArrowUp
} from 'lucide-react';
import '../style.css';

function LegacyRouteView() {
  return <Outlet />;
}

function SidebarButton({ action, view, icon: Icon, children }) {
  return (
    <button className="nav-item" data-action={action} data-view={view}>
      <Icon size={18} strokeWidth={1.8} />
      <span>{children}</span>
    </button>
  );
}

function Shell() {
  useEffect(() => {
    if (window.__codeminiLegacyLoaded) return;
    window.__codeminiLegacyLoaded = true;
    import('../main.js');
  }, []);

  return (
    <div id="app">
      <aside id="sidebar">
        <nav id="sidebar-nav">
          <SidebarButton action="new-session" icon={Upload}>新对话</SidebarButton>
          <SidebarButton view="sessions" icon={Search}>搜索对话</SidebarButton>
          <SidebarButton view="config" icon={Grid2X2}>插件与设置</SidebarButton>
          <SidebarButton view="config" icon={Clock3}>自动化设置</SidebarButton>

          <button className="sidebar-section-title collapsible-toggle" type="button" data-collapse-target="project-sidebar-section" aria-expanded="true">
            <span>项目</span>
            <ChevronDown className="collapse-chevron" size={18} strokeWidth={1.8} />
          </button>
          <div id="project-sidebar-section" className="sidebar-collapsible">
            <div id="project-session-list" className="sidebar-session-list" />
          </div>

          <button className="sidebar-section-title collapsible-toggle with-actions" type="button" data-collapse-target="conversation-sidebar-section" aria-expanded="true">
            <span>对话</span>
            <span className="collapse-actions">≡ ✎</span>
            <ChevronDown className="collapse-chevron" size={18} strokeWidth={1.8} />
          </button>
          <div id="conversation-sidebar-section" className="sidebar-collapsible">
            <div id="conversation-session-list" className="sidebar-session-list" />
          </div>
        </nav>

        <div id="sidebar-footer">
          <button id="theme-toggle" className="footer-button" type="button" title="切换明暗模式" aria-label="切换明暗模式">
            <SunMoon className="theme-icon" size={18} strokeWidth={1.8} />
            <span className="theme-label">深色</span>
          </button>
          <button id="settings-toggle" className="footer-button" type="button" title="设置" aria-label="设置">
            <Settings size={18} strokeWidth={1.8} />
            <span>设置</span>
          </button>
        </div>
      </aside>

      <div id="main-area">
        <div id="view-chat">
          <div id="chat-titlebar">
            <Bot size={18} strokeWidth={1.8} />
            <span id="chat-title">qurio-coder</span>
            <button className="icon-button" type="button" title="更多">
              <MoreHorizontal size={18} strokeWidth={1.8} />
            </button>
          </div>
          <div id="empty-state">
            <h1>要在 qurio-coder 中构建什么?</h1>
          </div>
          <main id="chat-panel" />
          <div id="plan-progress" className="hidden" />
          <div id="approval-overlay" className="hidden" />
          <button id="back-to-top" className="hidden" type="button" title="回到顶部" aria-label="回到顶部">
            <ArrowUp size={16} strokeWidth={1.8} />
          </button>
          <footer id="input-area" className="input-area">
            <div id="autocomplete" className="hidden" />
            <div id="input-bar" />
            <div className="input-meta-row">
              <button id="project-indicator" className="workspace-button" type="button" title="Current project">
                <Folder size={16} strokeWidth={1.8} />
                <span id="project-path-display">...</span>
              </button>
              <header id="status-bar" />
            </div>
          </footer>
        </div>
        <div id="view-sessions" className="hidden" />
        <div id="view-config" className="hidden" />
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: LegacyRouteView
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Shell
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: Shell
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Shell
});

const routeTree = rootRoute.addChildren([shellRoute, sessionsRoute, settingsRoute]);
const router = createRouter({ routeTree });

function App() {
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById('root')).render(<App />);
