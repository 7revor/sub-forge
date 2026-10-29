import { alertError, notifySuccess } from './feedback.ts';
// 外壳：左侧导航（窄屏时叠在上方）+ 内容区；未登录时跳转登录页。

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { api, onUnauthorized } from './api.ts';
import { LogoMark } from './components/LogoMark.tsx';
import { cx } from './components/ui.tsx';
import { useMe } from './hooks.ts';

type NavItem = { to: string; label: string; admin?: boolean; end?: boolean };
const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: '总览' }, { to: '/profiles', label: '订阅' }] },
  { title: '节点', items: [{ to: '/sources', label: '订阅' }, { to: '/locals', label: '本地' }, { to: '/collections', label: '组合' }] },
  { title: '规则', items: [{ to: '/rule-repo', label: '规则集合' }, { to: '/rulesets', label: '增强集合' }] },
  { title: '模板', items: [{ to: '/templates', label: '模板', admin: true, end: true }] },
  { title: '管理员', items: [{ to: '/presets', label: '基础设置预设', admin: true }, { to: '/users', label: '用户', admin: true }, { to: '/system', label: '系统', admin: true }] },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2.5 pt-1 pb-2">
      <LogoMark size={24} />
      <span className="font-mono text-[15px] font-semibold text-white">Sub Forge</span>
    </div>
  );
}

export function AppLayout() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  // 窄屏时导航折叠到菜单按钮里，切换页面后自动收起
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => onUnauthorized(() => {
    qc.setQueryData(['me'], null);
    navigate('/login', { replace: true, state: { from: location.pathname } });
  }), [qc, navigate, location.pathname]);

  if (me.isLoading) return <div className="p-8 text-muted">加载中…</div>;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const isAdmin = me.data.role === 'admin';

  const logout = async () => {
    try {
      await api('POST', '/auth/logout');
      qc.clear();
      navigate('/login', { replace: true });
      notifySuccess('已退出登录');
    } catch (error) { alertError(error); }
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-ground md:flex-row">
      <nav aria-label="主导航" className={cx('flex max-h-[45dvh] w-full shrink-0 flex-col gap-3.5 overflow-hidden bg-nav px-3 py-3 md:h-full md:max-h-none md:w-[216px] md:py-5', !menuOpen && 'max-md:pb-3')}>
        <div className="flex shrink-0 items-center justify-between">
          <Logo />
          <button type="button" aria-expanded={menuOpen} aria-label={menuOpen ? '收起菜单' : '展开菜单'} onClick={() => setMenuOpen(!menuOpen)}
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-md text-nav-text hover:bg-nav-hover md:hidden">
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <div className={cx('nav-scroll min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain', menuOpen ? 'flex' : 'hidden md:flex')}>
        {NAV.map((g, i) => {
          const items = g.items.filter((it) => !it.admin || isAdmin);
          if (!items.length) return null;
          return (
            <div key={i} className="flex flex-col gap-0.5">
              {g.title && <div className="px-2.5 pt-1.5 pb-1 text-[11px] tracking-[.08em] text-faint">{g.title}</div>}
              {items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === '/' || it.end}
                  className={({ isActive }) => cx('block rounded-md px-2.5 py-2.5 text-[13.5px] leading-5 no-underline', isActive ? 'bg-nav-active font-medium text-white' : 'text-nav-text hover:bg-nav-hover hover:text-white')}>
                  {it.label}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div className="mt-auto flex flex-col gap-1 border-t border-[#262b33] px-2.5 pt-3 text-[12.5px] text-faint">
          <NavLink to="/account" className="text-nav-text no-underline hover:text-white">{me.data.username} · {isAdmin ? '管理员' : '用户'}</NavLink>
          <button type="button" onClick={logout} className="w-fit cursor-pointer text-left text-faint hover:text-white">退出登录</button>
        </div>
        </div>
      </nav>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="page-layout">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.data?.role !== 'admin') return <div className="text-muted">需要管理员权限。</div>;
  return <>{children}</>;
}
