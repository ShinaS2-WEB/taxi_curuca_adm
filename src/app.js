import { config } from '../config.js';
import { loadDemo, persistDemo, seedData, money, dateValue, dateLabel, statusLabels, nextStatuses } from './data.js';
import { checkTransition, validateDriver, validateReview, validateAdmin, documentVersion } from './domain.js';

const demo = config.dataMode === 'demo';
const configured = ['apiKey', 'authDomain', 'projectId'].every(key => config.firebase[key]);
const root = document.querySelector('#root');
const emptyData = () => ({ users: [], drivers: [], driverApplications: [], trips: [], chats: [], admins: [] });
function savedSidebarState() {
  try { return localStorage.getItem('taxi-curuca-sidebar-collapsed') === 'true'; } catch { return false; }
}
const state = { data: demo ? { ...seedData(), ...loadDemo() } : emptyData(), user: demo ? { uid: 'demo-admin', displayName: 'Administrador' } : null, page: 'overview', query: '', filter: 'all', period: '7', pagination: 1, loading: !demo, error: '', updated: null };
const navigation = [['overview', 'Visão geral', 'grid'], ['trips', 'Viagens', 'car'], ['drivers', 'Motoristas', 'user'], ['applications', 'Solicitações', 'check'], ['passengers', 'Passageiros', 'users'], ['chats', 'Conversas', 'chat'], ['admins', 'Administradores', 'check']];
state.sidebarCollapsed = savedSidebarState();
let backend, stopData, stopMessages, stopAccess, sessionGeneration = 0, modalItem, modalReturnFocus, busy = false;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paths = {
  car: '<path d="m5 7 2-4h10l2 4M3 8h18v10H3zM6 18v3m12-3v3M6 12h2m8 0h2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
  users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 3a4 4 0 0 1 0 8m2 4a5 5 0 0 1 3 5"/>',
  check: '<path d="m4 12 5 5L20 6"/>', chat: '<path d="M3 3h18v14H8l-5 4z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', close: '<path d="m5 5 14 14M5 19 19 5"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>', refresh: '<path d="M20 7V2m0 5h-5M4 17v5m0-5h5M4 9a8 8 0 0 1 14-5l2 3M4 17l2 3a8 8 0 0 0 14-5"/>',
  pin: '<path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2"/>',
  menu: '<path d="M3 5h18M3 12h18M3 19h18"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5"/>',
  settings: '<circle cx="12" cy="12" r="4"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4M4 4l3 3m10 10 3 3M4 20l3-3M17 7l3-3"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3v1"/>',
};
const icon = name => `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
const button = (action, label, id = '', cls = 'button') => `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
const avatar = name => `<span class="avatar small">${esc((name || '?').split(' ').slice(0, 2).map(v => v[0]).join(''))}</span>`;
const badge = status => `<span class="badge ${Object.hasOwn(statusLabels, status) ? status : 'offline'}"><i></i>${esc(statusLabels[status] || status)}</span>`;
const person = id => state.data.users.find(u => u.id === id)?.fullName || id || 'Não informado';
const driver = id => state.data.drivers.find(d => d.id === id);
const empty = (text = 'Nenhum registro encontrado.') => `<div class="empty">${icon('search')}<h3>${esc(text)}</h3><p>Experimente ajustar a busca ou os filtros.</p></div>`;
const details = rows => `<dl>${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value ?? 'Não informado')}</dd>`).join('')}</dl>`;
const pending = () => state.data.driverApplications.filter(a => a.status === 'pending');
const title = () => navigation.find(([id]) => id === state.page)?.[1] || 'Configurações';
function errorMessage(error) {
  if (error.code === 'auth/email-already-in-use') return 'Este e-mail já possui uma conta no Firebase. Use outro e-mail ou autorize a conta existente pelo procedimento administrativo do README.';
  if (error.code === 'auth/weak-password' || error.code === 'auth/password-does-not-meet-requirements') return 'A senha não atende à política de segurança do projeto. Escolha uma senha mais forte.';
  if (error.code === 'permission-denied') return 'Acesso negado. Confira a permissão administrativa e as regras publicadas no Firebase.';
  if (error.code === 'unavailable') return 'Sem conexão com o Firebase. Confira a internet e tente novamente.';
  if (error.code?.startsWith('auth/')) return 'Não foi possível entrar. Confira seu e-mail, senha e a configuração de autenticação.';
  return error.message || 'Não foi possível concluir a operação.';
}
function showError(error) {
  const target = document.querySelector('dialog[open] [data-modal-error]');
  if (target) { target.textContent = errorMessage(error); target.hidden = false; }
  else { state.error = errorMessage(error); render(); }
}
function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div'); el.className = 'toast'; el.role = 'status'; el.textContent = message;
  document.body.append(el); setTimeout(() => el.remove(), 4500);
}
function renderLogin() {
  root.innerHTML = `<main class="login"><div class="login-art"><div class="brand"><span class="brand-symbol">${icon('car')}</span><span>taxi curu??<small>CENTRAL ADMINISTRATIVA</small></span></div><h1>Conectando caminhos.<br>Cuidando de pessoas.</h1><p>Toda a sua opera??o, em um s? lugar.</p><div class="login-road"></div></div><div class="login-form"><span class="eyebrow">BEM-VINDO DE VOLTA</span><h2>Acesse sua central</h2><p>Entre com sua conta de administrador.</p>${state.error ? `<div class="error" role="alert">${esc(state.error)}</div>` : ''}${!configured ? '<div class="settings-note">O painel ainda n?o est? conectado. Preencha a configura??o Web do Firebase em <code>config.js</code>, conforme o README do projeto.</div>' : ''}<form data-form="login"><label>E-mail<input name="email" type="email" autocomplete="username" placeholder="voce@empresa.com" required></label><label>Senha<input name="password" type="password" autocomplete="current-password" placeholder="Sua senha" required></label><div class="login-options">${button('toggle-password', 'Mostrar senha', '', 'text-button')}<button type="button" class="text-button" data-action="forgot-password" ${backend ? '' : 'disabled'}>Esqueci minha senha</button></div><button class="button primary" ${backend ? '' : 'disabled'}>Entrar no painel ${icon('arrow')}</button></form><small>${icon('check')} Acesso exclusivo ? administra??o Taxi Curu??</small></div></main>`;
}
function render() {
  if (!state.user) return renderLogin();
  const search = document.querySelector('[data-search]');
  const selection = document.activeElement === search ? [search.selectionStart, search.selectionEnd] : null;
  root.innerHTML = `<div class="app-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside id="main-sidebar" class="sidebar" aria-label="Menu principal"><a class="brand" href="#overview"><span class="brand-symbol">${icon('car')}</span><span>taxi curuçá<small>PAINEL ADMINISTRATIVO</small></span></a><div class="workspace"><span class="workspace-icon">${icon('pin')}</span><div><strong>Central de operações</strong><small>Curuçá, Pará</small></div><span class="live-dot"></span></div><span class="nav-label">PRINCIPAL</span><nav>${navigation.map(([id, label, glyph]) => button('navigate', `${icon(glyph)}<span>${label}</span>${id === 'applications' && pending().length ? `<b>${pending().length}</b>` : ''}`, id, state.page === id ? 'selected' : '')).join('')}</nav><div class="sidebar-bottom"><div class="operation-card"><span class="live-dot"></span><strong>Sua operação conectada</strong><p>Mais mobilidade para quem<br>faz parte da nossa cidade.</p><div class="mini-road">${icon('car')}<span>CURUÇÁ →</span></div></div>${button('navigate', `${icon('settings')} Configurações`, 'settings', 'bottom-link')}${button('help', `${icon('help')} Central de ajuda`, '', 'bottom-link')}<div class="sidebar-footer">Taxi Curuçá <span>v2.0</span></div></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumb"><button type="button" class="icon-button sidebar-toggle" data-action="sidebar-toggle" aria-controls="main-sidebar" aria-expanded="${!state.sidebarCollapsed}" aria-label="${state.sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}" title="${state.sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}">${icon('menu')}</button>${button('menu', icon('menu') + '<span class="sr-only">Abrir menu</span>', '', 'icon-button mobile-menu')}<span>Administração</span>${icon('arrow')}<strong>${title()}</strong></div><div class="topbar-right"><span class="environment"><span class="live-dot"></span>${demo ? 'Ambiente demonstrativo' : state.loading ? 'Conectando ao Firebase' : state.error ? 'Conexão interrompida' : 'Atualização em tempo real'}</span>${button('notifications', icon('chat') + '<span class="sr-only">Notificações</span>', '', 'icon-button')}${button('navigate', `${avatar(state.user.displayName || state.user.email)}<span><strong>Administrador</strong><small>Gestão da plataforma</small></span>`, 'settings', 'account')}</div></header><main class="main-content"><div class="page-heading"><div><div class="eyebrow">CENTRAL DE OPERAÇÕES / ${esc(new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }))}</div><h1>${state.page === 'overview' ? 'Sua operação, em movimento.' : title()}</h1><p>Acompanhe as viagens, cuide da sua equipe e conecte mais pessoas.</p></div><div class="heading-actions">${state.page === 'overview' ? `<label class="period"><select data-period aria-label="Período do painel">${[['1', 'Hoje'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias']].map(([v, label]) => `<option value="${v}" ${state.period === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}${!['settings', 'chats'].includes(state.page) ? button('export', icon('download') + 'Exportar relatório') : ''}</div></div>${demo ? `<div class="demo-banner"><span><span class="demo-tag">DEMO</span>Dados de exemplo. As alterações ficam neste navegador.</span></div>` : ''}${state.error ? `<div class="error" role="alert">${esc(state.error)}${button('refresh', 'Tentar atualizar', '', 'text-button')}</div>` : ''}${state.loading ? '<div class="panel loading-screen">Carregando dados da operação…</div>' : state.page === 'overview' ? overview() : state.page === 'settings' ? settings() : records()}<div class="bottom-info">${icon('check')}<span>${demo ? 'Demonstração local' : 'Firebase · sincronização automática'}</span><span>${state.updated ? `Atualizado às ${state.updated.toLocaleTimeString('pt-BR')}` : ''}</span></div></main><footer class="page-footer"><span>© ${new Date().getFullYear()} Taxi Curuçá</span><span>Feito para aproximar.</span></footer></div></div>`;
  document.querySelector('.sidebar .brand')?.setAttribute('aria-label', 'Taxi Curuçá — Visão geral');
  document.querySelectorAll('.sidebar button').forEach(el => {
    const label = el.querySelector('span')?.textContent || el.textContent.trim();
    el.setAttribute('aria-label', label);
    el.title = label;
  });
  if (selection) { const field = document.querySelector('[data-search]'); field?.focus(); field?.setSelectionRange(...selection); }
}
function filteredTrips() {
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - Number(state.period) + 1);
  return state.data.trips.filter(t => (state.page !== 'overview' || (dateValue(t.createdAt) >= cutoff && dateValue(t.createdAt) <= new Date())) && (state.filter === 'all' || t.status === state.filter) && matches(t.id, person(t.passengerId), driver(t.driverId)?.name, driver(t.driverId)?.origin, driver(t.driverId)?.destination)).sort((a, b) => (dateValue(b.createdAt)?.getTime() || 0) - (dateValue(a.createdAt)?.getTime() || 0));
}
function matches(...values) { const term = state.query.trim().toLocaleLowerCase('pt-BR'); return values.some(v => String(v ?? '').toLocaleLowerCase('pt-BR').includes(term)); }
function filteredRecords() {
  if (state.page === 'admins') return (state.data.admins || []).filter(a => matches(a.name, a.email) && (state.filter === 'all' || a.active === (state.filter === 'active')));
  if (['overview', 'trips'].includes(state.page)) return filteredTrips();
  if (state.page === 'drivers') return state.data.drivers.filter(d => matches(d.name, d.vehicleModel, d.origin, d.destination) && (state.filter === 'all' || (state.filter === 'online' ? d.online : state.filter === 'offline' ? !d.online : d.vehicleType === state.filter)));
  if (state.page === 'applications') return state.data.driverApplications.filter(a => matches(person(a.userId), a.vehicleModel, a.plate) && (state.filter === 'all' || state.filter === a.status));
  if (state.page === 'passengers') return state.data.users.filter(u => matches(u.fullName, u.email, u.phone));
  return state.data.chats.filter(c => matches(c.lastMessage, ...(c.participantIds || []).map(person)));
}
function table(headers, rows) { return `<div class="table-scroll"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>${rows.length ? '' : empty()}`; }
function tripTable(compact = false) {
  const trips = filteredTrips();
  const totalPages = Math.max(1, Math.ceil(trips.length / 8)); state.pagination = Math.min(state.pagination, totalPages);
  const visible = compact ? trips.slice(0, 5) : trips.slice((state.pagination - 1) * 8, state.pagination * 8);
  return table(['VIAGEM / PASSAGEIRO', 'MOTORISTA', 'TRAJETO ATUAL DO MOTORISTA', 'STATUS', 'DATA', ''], visible.map(t => `<tr><td><div class="person">${avatar(person(t.passengerId))}<div><strong>${esc(person(t.passengerId))}</strong><small>#${esc(t.id)} · ${esc(t.seats)} vagas</small></div></div></td><td>${esc(driver(t.driverId)?.name || t.driverId)}<small>${esc(driver(t.driverId)?.vehicleModel)}</small></td><td>${esc(driver(t.driverId)?.origin || 'Não informado')}<small>→ ${esc(driver(t.driverId)?.destination || 'Não informado')}</small></td><td>${badge(t.status)}</td><td>${esc(dateLabel(t.createdAt))}</td><td>${button('trip', `Detalhes<span class="sr-only"> da viagem ${esc(t.id)}</span>`, t.id, 'button small-button')}</td></tr>`)) + (compact ? '' : `<div class="pagination"><span>${trips.length} viagens encontradas</span><div><button class="icon-button" data-action="previous" aria-label="Página anterior" ${state.pagination <= 1 ? 'disabled' : ''}>‹</button><span>${state.pagination} de ${totalPages}</span><button class="icon-button" data-action="next" aria-label="Próxima página" ${state.pagination >= totalPages ? 'disabled' : ''}>›</button></div></div>`);
}
function metric(label, value, note, glyph, color) { return `<article class="metric"><div class="metric-top"><span>${label}</span><span class="metric-icon ${color}">${icon(glyph)}</span></div><strong>${esc(value)}</strong><div class="metric-note">${esc(note)}</div></article>`; }
function chart() {
  const days = Array.from({ length: 7 }, (_, i) => { const date = new Date(); date.setDate(date.getDate() - 6 + i); return { label: date.toLocaleDateString('pt-BR', { weekday: 'short' }), count: state.data.trips.filter(t => dateValue(t.createdAt)?.toDateString() === date.toDateString()).length }; });
  const max = Math.max(4, ...days.map(d => d.count)); const points = days.map((d, i) => `${48 + i * 89},${169 - d.count / max * 127}`).join(' ');
  return `<div class="activity-chart"><svg viewBox="0 0 630 205" role="img" aria-label="${esc(days.map(d => `${d.label}: ${d.count} viagens`).join('; '))}">${[0, 1, 2, 3, 4].map(i => `<line x1="48" x2="582" y1="${169 - i * 31.75}" y2="${169 - i * 31.75}" stroke="#e2e8f0" stroke-dasharray="3 4"/><text x="13" y="${173 - i * 31.75}">${Math.round(max * i / 4)}</text>`).join('')}<polygon points="48,169 ${points} 582,169" fill="#3b82f6" opacity=".15"/><polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="2.6"/>${days.map((d, i) => `<circle cx="${48 + i * 89}" cy="${169 - d.count / max * 127}" r="4" fill="white" stroke="#2563eb"/><text x="${48 + i * 89}" y="197" text-anchor="middle">${esc(d.label)}</text>`).join('')}</svg></div>`;
}
function overview() {
  const trips = filteredTrips(), completed = trips.filter(t => t.status === 'completed');
  const estimated = completed.reduce((sum, t) => sum + (driver(t.driverId)?.priceCents || 0) * (driver(t.driverId)?.serviceType === 'shared' ? t.seats : 1), 0);
  return `<section class="metrics">${metric('Viagens no período', trips.length, `${trips.filter(t => nextStatuses[t.status]?.length).length} viagens em aberto`, 'car', 'green')}${metric('Motoristas online', state.data.drivers.filter(d => d.online).length, `${state.data.drivers.length} motoristas cadastrados`, 'user', 'blue')}${metric('Passageiros cadastrados', state.data.users.length, 'Pessoas conectadas à plataforma', 'users', 'purple')}${metric('Valor estimado de viagens', money(estimated), 'Concluídas · tarifa atual, sem repasses', 'car', 'orange')}</section><div class="dashboard-middle"><section class="panel chart-panel"><div class="panel-heading"><div><h2>O ritmo da sua operação</h2><p>Volume de viagens nos últimos 7 dias</p></div></div>${chart()}<div class="chart-footer">${completed.length} viagens concluídas no período selecionado</div></section><section class="panel approvals-panel"><div class="panel-heading"><div><h2>Novos caminhos</h2><p>Motoristas aguardando aprovação</p></div><span class="count-pill">${pending().length}</span></div>${pending().slice(0, 3).map(a => button('review', `${avatar(person(a.userId))}<span><strong>${esc(person(a.userId))}</strong><small>${esc(a.vehicleModel)}</small></span>${icon('arrow')}`, a.id, 'application-preview')).join('') || '<div class="all-clear">Nenhuma solicitação pendente.</div>'}${button('navigate', 'Ver todas as solicitações →', 'applications', 'approval-footer')}</section></div><section class="panel"><div class="panel-heading"><h2>Últimas viagens</h2>${button('navigate', 'Ver todas →', 'trips', 'text-button')}</div>${tripTable(true)}</section>`;
}
function records() {
  const rows = filteredRecords();
  const filters = { trips: ['confirmed', 'accepted', 'in_progress', 'completed', 'cancelled'], drivers: ['online', 'offline', 'car', 'motorcycle'], applications: ['pending', 'approved', 'rejected'] }[state.page];
  const labels = { online: 'Online', offline: 'Offline', car: 'Carro', motorcycle: 'Moto', ...statusLabels };
  const toolbar = `<div class="records-toolbar"><div class="search-input">${icon('search')}<input data-search aria-label="Buscar registros" placeholder="Buscar por nome ou informação…" value="${esc(state.query)}"></div><div class="toolbar-right">${filters ? `<label class="filter-select"><select data-filter aria-label="Filtrar registros"><option value="all">Todos os status</option>${filters.map(v => `<option value="${v}" ${state.filter === v ? 'selected' : ''}>${labels[v]}</option>`).join('')}</select></label>` : ''}${button('refresh', icon('refresh') + '<span class="sr-only">Atualizar dados</span>', '', 'icon-button')}</div></div>`;
  let content;
  if (state.page === 'admins') content = `<div class="records-toolbar"><p>Gerencie as pessoas que podem administrar a plataforma.</p>${button('admin-new', 'Novo administrador', '', 'button primary')}</div>` + table(['ADMINISTRADOR', 'E-MAIL DE ACESSO', 'SITUAÇÃO', ''], rows.map(a => `<tr><td><div class="person">${avatar(a.name)}<strong>${esc(a.name)}${a.id === state.user.uid ? ' (você)' : ''}</strong></div></td><td>${esc(a.email)}</td><td><span class="badge ${a.active ? 'approved' : 'offline'}">${a.active ? 'Ativo' : 'Desativado'}</span></td><td>${button('admin-edit', 'Editar', a.id, 'button small-button')}</td></tr>`));
  if (state.page === 'trips') content = tripTable();
  if (state.page === 'drivers') content = `<div class="drivers-grid">${rows.map(d => `<article class="driver-card"><div class="driver-card-top">${avatar(d.name)}<span class="badge ${d.online ? 'approved' : 'offline'}">${d.online ? 'Online' : 'Offline'}</span></div><h3>${esc(d.name)}</h3><p>${esc(d.vehicleModel)} · ${esc(d.vehicleColor || 'Cor não informada')}</p><div class="driver-tags"><span>${d.vehicleType === 'car' ? 'Carro' : 'Moto'}</span><span>${d.serviceType === 'shared' ? 'Lotação' : 'Particular'}</span></div><div class="driver-route">${icon('pin')}<div><strong>${esc(d.origin || 'Origem não configurada')}</strong><small>${esc(d.destination || 'Destino não configurado')}</small></div></div><div class="driver-card-bottom"><span><strong>${money(d.priceCents)}</strong><small>${esc(d.seatsAvailable)}/${esc(d.seatsTotal)} vagas livres</small></span>${button('driver', 'Gerenciar →', d.id)}</div></article>`).join('') || empty()}</div>`;
  if (state.page === 'applications') content = table(['CANDIDATO', 'VEÍCULO', 'PLACA', 'RECEBIDA EM', 'STATUS', ''], rows.map(a => `<tr><td><div class="person">${avatar(person(a.userId))}<strong>${esc(person(a.userId))}</strong></div></td><td>${esc(a.vehicleModel)}</td><td><span class="plate">${esc(a.plate)}</span></td><td>${dateLabel(a.submittedAt)}</td><td>${badge(a.status)}</td><td>${button('review', a.status === 'pending' ? 'Analisar' : 'Detalhes', a.id, 'button small-button')}</td></tr>`));
  if (state.page === 'passengers') content = table(['PASSAGEIRO', 'CONTATO', 'CIDADE', 'PERFIL', ''], rows.map(u => `<tr><td><div class="person">${avatar(u.fullName)}<strong>${esc(u.fullName)}</strong></div></td><td>${esc(u.email)}<small>${esc(u.phone)}</small></td><td>${esc(u.city || 'Não informada')}</td><td>${u.profileComplete ? 'Completo' : 'Incompleto'}</td><td>${button('passenger', 'Ver perfil', u.id, 'button small-button')}</td></tr>`));
  if (state.page === 'chats') content = `<div class="chat-list">${rows.map(c => button('chat', `<span class="chat-icon">${icon('chat')}</span><div><strong>${esc((c.participantIds || []).map(person).join(' e '))}</strong><p>${esc(c.lastMessage || 'Sem mensagens')}</p><small>${dateLabel(c.updatedAt)} · Viagem ${esc(c.tripId || 'não vinculada')}</small></div>${icon('arrow')}`, c.id, '')).join('') || empty('Nenhuma conversa encontrada.')}</div>`;
  return `<section class="panel records-panel">${toolbar}${content}</section>`;
}
function settings() {
  return `<div class="settings-grid"><section class="panel settings-card"><span class="settings-icon">${icon('check')}</span><h2>Ambiente da plataforma</h2><p>${demo ? 'Você está usando dados demonstrativos neste navegador.' : 'Dados sincronizados diretamente com o Firebase do aplicativo.'}</p>${details([['Fonte de dados', demo ? 'Exemplos locais' : 'Cloud Firestore'], ['Projeto', demo ? 'Demonstração' : config.firebase.projectId], ['Acesso', state.user.email || 'Demonstração']])}${demo ? button('reset', 'Restaurar demonstração') : button('logout', 'Sair da conta')}</section><section class="panel settings-card"><span class="settings-icon">${icon('settings')}</span><h2>Sua central conectada</h2><p>Viagens, cadastros e conversas são atualizados automaticamente enquanto o painel está aberto.</p><p>As permissões administrativas são gerenciadas no Firebase. Consulte o README para configurar o projeto e autorizar sua conta.</p><div class="settings-note">O valor das viagens é uma estimativa com a tarifa atual do motorista. O aplicativo ainda não registra pagamentos nem tarifas históricas.</div></section></div>`;
}
function openModal(titleText, content, item) {
  closeModal(); modalItem = item; modalReturnFocus = document.activeElement;
  const el = document.createElement('dialog'); el.setAttribute('aria-labelledby', 'modal-title');
  el.innerHTML = `<div class="modal-top"><h2 id="modal-title">${esc(titleText)}</h2>${button('close', icon('close') + '<span class="sr-only">Fechar</span>', '', 'icon-button')}</div><div class="modal-content"><div data-modal-error class="error" role="alert" hidden></div>${content}</div>`;
  el.addEventListener('cancel', e => { e.preventDefault(); if (!busy) closeModal(); });
  el.addEventListener('click', e => { if (e.target === el && !busy) closeModal(); });
  document.body.append(el); el.showModal();
}
function closeModal() { stopMessages?.(); stopMessages = null; document.querySelector('dialog')?.remove(); modalItem = null; modalReturnFocus?.focus(); }
const field = (label, name, value, attributes = '') => `<label>${label}<input name="${name}" value="${esc(value)}" ${attributes}></label>`;
const select = (label, name, value, options) => `<label>${label}<select name="${name}">${options.map(([v, text]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
function driverModal(d) {
  openModal('Gerenciar motorista', `<form data-form="driver"><div class="form-grid">${field('Nome', 'name', d.name, 'required minlength="2" maxlength="120"')}${field('Veículo', 'vehicleModel', d.vehicleModel, 'required minlength="2" maxlength="100"')}${field('Cor', 'vehicleColor', d.vehicleColor || '', 'maxlength="40"')}${select('Tipo', 'vehicleType', d.vehicleType, [['car', 'Carro'], ['motorcycle', 'Moto']])}${select('Serviço', 'serviceType', d.serviceType, [['private', 'Particular'], ['shared', 'Lotação']])}${field('Origem', 'origin', d.origin, 'required minlength="2" maxlength="150"')}${field('Destino', 'destination', d.destination, 'required minlength="2" maxlength="150"')}${field('Preço (R$)', 'price', (d.priceCents / 100).toFixed(2), 'type="number" step="0.01" min="0" max="10000" required')}${field('Capacidade', 'seatsTotal', d.seatsTotal, 'type="number" min="1" max="20" required')}${field('Vagas disponíveis', 'seatsAvailable', d.seatsAvailable, 'type="number" min="0" max="20" required')}<label class="switch-label"><input name="online" type="checkbox" ${d.online ? 'checked' : ''}>Disponível no aplicativo</label></div><div class="modal-actions"><button class="button primary">Salvar alterações</button></div></form>`, d);
}
function adminModal(a = null) {
  const self = a?.id === state.user.uid;
  openModal(a ? 'Editar administrador' : 'Novo administrador', `<form data-form="admin"><div class="form-grid">${field('Nome', 'name', a?.name || '', 'required minlength="2" maxlength="120" autocomplete="name"')}${field('E-mail de acesso', 'email', a?.email || '', `type="email" required maxlength="254" autocomplete="off" ${a ? 'readonly' : ''}`)}${a ? '' : field('Senha inicial', 'password', '', 'type="password" required minlength="8" maxlength="128" autocomplete="new-password"')}<label class="switch-label"><input name="active" type="checkbox" ${!a || a.active ? 'checked' : ''} ${self ? 'disabled' : ''}>Acesso administrativo ativo</label></div><p class="settings-note">${a ? 'O e-mail identifica a conta de acesso. Para trocar a senha, envie um link de recuperação.' : 'A nova conta poderá entrar com este e-mail e senha. Você continuará conectado à sua própria conta.'}${self ? ' Sua própria conta não pode ser desativada.' : ' Desativar impede o acesso administrativo, inclusive em sessões abertas.'}</p><div class="modal-actions">${a ? button('admin-reset', 'Enviar recuperação de senha', a.email) : ''}<button class="button primary">${a ? 'Salvar administrador' : 'Criar administrador'}</button></div></form>`, a);
}
async function submitAdmin(values) {
  const item = modalItem;
  const input = { ...values, active: item?.id === state.user.uid || values.active === 'on' };
  const body = validateAdmin(input, !item);
  if (demo) {
    const copy = structuredClone(state.data);
    if (item) Object.assign(copy.admins.find(a => a.id === item.id), body, { updatedAt: new Date().toISOString() });
    else {
      if (copy.admins.some(a => a.email === body.email)) throw new Error('Já existe um administrador com este e-mail.');
      copy.admins.push({ ...body, id: crypto.randomUUID(), createdBy: state.user.uid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    persistDemo(copy); state.data = copy; render();
  } else if (item) {
    const { id, ...profile } = item;
    await backend.saveAdmin(id, body, documentVersion(profile));
  } else await backend.createAdmin(input);
  closeModal(); toast(item ? 'Administrador atualizado.' : demo ? 'Administrador de exemplo criado. Nenhuma conta real foi criada.' : 'Administrador criado.');
}
function tripModal(t) {
  openModal('Detalhes da viagem', `${badge(t.status)}${details([['Código', t.id], ['Passageiro', person(t.passengerId)], ['Motorista', driver(t.driverId)?.name || t.driverId], ['Rota registrada', t.routeId], ['Vagas reservadas', t.seats], ['Data', dateLabel(t.createdAt)]])}<p class="settings-note">A alteração atualiza o status da viagem. Revise a disponibilidade do motorista separadamente.</p><div class="modal-actions">${(nextStatuses[t.status] || []).map(status => button('trip-status', ({ accepted: 'Aceitar viagem', in_progress: 'Iniciar viagem', completed: 'Concluir viagem', cancelled: 'Cancelar viagem' })[status], status, `button ${status === 'cancelled' ? 'danger' : 'primary'}`)).join('')}</div>`, t);
}
function reviewModal(a) {
  openModal('Análise de cadastro', `<h3>${esc(person(a.userId))}</h3>${badge(a.status)}${details([['Veículo', a.vehicleModel], ['Tipo', a.vehicleType === 'car' ? 'Carro' : 'Moto'], ['Placa', a.plate], ['Enviado em', dateLabel(a.submittedAt)], ['Observação', a.reason || '—']])}${a.status === 'pending' ? '<p class="settings-note">Confira a documentação com o candidato antes de aprovar. O cadastro do aplicativo não contém anexos de documentos.</p><form data-form="review"><label>Motivo da recusa<textarea name="reason" maxlength="500" rows="3" placeholder="Mínimo de 5 caracteres para recusar"></textarea></label><div class="modal-actions"><button class="button danger" name="status" value="rejected">Recusar cadastro</button><button class="button primary" name="status" value="approved">Aprovar motorista</button></div></form>' : ''}`, a);
}
async function mutate(action, input) {
  const item = modalItem;
  if (!item) return;
  if (demo) {
    const copy = structuredClone(state.data);
    if (action === 'driver') {
      const body = validateDriver(input);
      if (body.online && copy.users.find(u => u.id === item.id)?.driverApproved !== true) throw new Error('Motorista sem aprovação.');
      Object.assign(copy.drivers.find(d => d.id === item.id), body);
    } else if (action === 'review') {
      const body = validateReview(input); const a = copy.driverApplications.find(a => a.id === item.id);
      if (a.status !== 'pending') throw new Error('Solicitação já revisada.');
      Object.assign(a, body, { updatedAt: new Date().toISOString() });
      if (body.status === 'approved') {
        const user = copy.users.find(u => u.id === a.userId); user.driverApproved = true;
        if (!copy.drivers.some(d => d.id === user.id)) copy.drivers.push({ id: user.id, uid: user.id, name: user.fullName, vehicleModel: a.vehicleModel, vehicleType: a.vehicleType, vehicleColor: '', serviceType: 'private', origin: '', destination: '', priceCents: 0, seatsTotal: 1, seatsAvailable: 1, online: false });
      }
    } else { const t = copy.trips.find(t => t.id === item.id); checkTransition(t.status, input.status); t.status = input.status; }
    persistDemo(copy); state.data = copy; state.updated = new Date(); render();
  } else if (action === 'driver') await backend.saveDriver(item.id, input, item.version);
  else if (action === 'review') await backend.reviewApplication(item.id, input);
  else await backend.changeTripStatus(item.id, input.status);
  closeModal(); toast('Alteração salva com sucesso.');
}
async function runBusy(task) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('dialog button, dialog input, dialog select, dialog textarea, [data-form="login"] button')];
  controls.forEach(el => { el.disabled = true; });
  try { await task(); } catch (error) { showError(error); } finally { busy = false; controls.forEach(el => { el.disabled = false; }); }
}
function exportData() {
  let rows = filteredRecords();
  if (state.page === 'admins') rows = rows.map(a => ({ Nome: a.name, Email: a.email, Acesso: a.active ? 'Ativo' : 'Desativado' }));
  else if (state.page === 'drivers') rows = rows.map(d => ({ Nome: d.name, Veículo: d.vehicleModel, Origem: d.origin, Destino: d.destination, Preço: money(d.priceCents), Vagas: d.seatsAvailable, Disponibilidade: d.online ? 'Online' : 'Offline' }));
  else if (state.page === 'passengers') rows = rows.map(u => ({ Nome: u.fullName, Email: u.email, Telefone: u.phone, Cidade: u.city }));
  else if (state.page === 'applications') rows = rows.map(a => ({ Nome: person(a.userId), Veículo: a.vehicleModel, Placa: a.plate, Status: statusLabels[a.status] }));
  else rows = rows.map(t => ({ Código: t.id, Passageiro: person(t.passengerId), Motorista: driver(t.driverId)?.name, Vagas: t.seats, Status: statusLabels[t.status], Data: dateLabel(t.createdAt) }));
  if (!rows.length) return toast('Não há registros para exportar.');
  const cell = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"', '""') + '"';
  const csv = '\uFEFF' + [Object.keys(rows[0]), ...rows.map(Object.values)].map(row => row.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = `taxi-curuca-${state.page}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Relatório exportado.');
}
function startData() {
  stopData?.(); state.loading = true; state.error = ''; render();
  const generation = sessionGeneration;
  stopData = backend.subscribeData(data => { if (generation !== sessionGeneration) return; state.data = data; state.loading = false; state.updated = new Date(); render(); }, error => {
    if (generation !== sessionGeneration) return;
    stopData?.(); stopMessages?.(); closeModal(); state.data = emptyData(); state.loading = false; showError(error);
  });
}
function navigate(page) {
  if (![...navigation.map(n => n[0]), 'settings'].includes(page)) page = 'overview';
  state.page = page; state.query = ''; state.filter = 'all'; state.pagination = 1;
  document.querySelector('.sidebar-scrim')?.remove(); render();
}
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
document.addEventListener('input', event => { if (event.target.matches('[data-search]')) { state.query = event.target.value; state.pagination = 1; render(); } });
document.addEventListener('change', event => {
  if (event.target.matches('[data-filter]')) { state.filter = event.target.value; state.pagination = 1; render(); }
  if (event.target.matches('[data-period]')) { state.period = event.target.value; render(); }
});
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]'); if (!form) return;
  event.preventDefault(); const values = Object.fromEntries(new FormData(form)); const type = form.dataset.form;
  if (type === 'login') return void runBusy(() => backend.login(values.email, values.password));
  if (type === 'admin') return void runBusy(() => submitAdmin(values));
  if (type === 'password-reset') return void runBusy(async () => { await backend.resetPassword(values.email); closeModal(); toast('Se houver uma conta para este e-mail, você receberá as instruções de recuperação.'); });
  if (type === 'driver') return void runBusy(() => mutate('driver', { ...values, priceCents: Math.round(Number(values.price) * 100), seatsTotal: Number(values.seatsTotal), seatsAvailable: Number(values.seatsAvailable), online: values.online === 'on' }));
  if (type === 'review') { const status = event.submitter?.value; void runBusy(() => mutate('review', { status, reason: status === 'approved' ? '' : values.reason })); }
});
document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled || busy) return;
  const { action, id } = el.dataset;
  try {
    if (action === 'sidebar-toggle') {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      try { localStorage.setItem('taxi-curuca-sidebar-collapsed', String(state.sidebarCollapsed)); } catch { /* Keep the preference for this session when storage is unavailable. */ }
      render();
      document.querySelector('[data-action="sidebar-toggle"]')?.focus();
    }
    if (action === 'admin-new') adminModal();
    if (action === 'admin-edit') adminModal(state.data.admins.find(a => a.id === id));
    if (action === 'admin-reset') await runBusy(async () => { if (demo) toast('Demonstração: nenhum e-mail foi enviado.'); else { await backend.resetPassword(id); toast('Solicitação de recuperação de senha enviada.'); } });
    if (action === 'forgot-password') openModal('Recuperar senha', `<form data-form="password-reset">${field('E-mail da sua conta', 'email', document.querySelector('[name="email"]')?.value || '', 'type="email" required autocomplete="email"')}<div class="modal-actions"><button class="button primary">Enviar link de recuperação</button></div></form>`);
    if (action === 'toggle-password') { const input = document.querySelector('[data-form="login"] [name="password"]'); input.type = input.type === 'password' ? 'text' : 'password'; el.textContent = input.type === 'password' ? 'Mostrar senha' : 'Ocultar senha'; }
    if (action === 'navigate') { location.hash = id; navigate(id); }
    if (action === 'menu') { document.querySelector('.sidebar').classList.add('open'); const scrim = document.createElement('div'); scrim.className = 'sidebar-scrim'; scrim.onclick = () => { scrim.remove(); document.querySelector('.sidebar')?.classList.remove('open'); }; document.body.append(scrim); }
    if (action === 'close') closeModal();
    if (action === 'notifications') openModal('Central de notificações', `<p>${pending().length} solicitações de motorista aguardam análise.</p>${button('pending', 'Ver solicitações')}`);
    if (action === 'pending') { closeModal(); location.hash = 'applications'; navigate('applications'); }
    if (action === 'refresh') { if (demo) { state.data = loadDemo(); state.updated = new Date(); render(); } else startData(); }
    if (action === 'export') exportData();
    if (action === 'previous' || action === 'next') { state.pagination += action === 'next' ? 1 : -1; render(); }
    if (action === 'driver') { const generation = sessionGeneration; const d = demo ? driver(id) : await backend.getDriver(id); if (state.user && generation === sessionGeneration) driverModal(d); }
    if (action === 'trip') tripModal(state.data.trips.find(t => t.id === id));
    if (action === 'review') reviewModal(state.data.driverApplications.find(a => a.id === id));
    if (action === 'trip-status') await runBusy(() => mutate('trip', { status: id }));
    if (action === 'passenger') { const u = state.data.users.find(u => u.id === id); openModal('Perfil do passageiro', `<h3>${esc(u.fullName)}</h3>${details([['E-mail', u.email], ['Telefone', u.phone], ['Cidade', u.city], ['Nascimento', u.birthDate], ['Contato de emergência', u.emergencyContact], ['Motorista aprovado', u.driverApproved ? 'Sim' : 'Não']])}`, u); }
    if (action === 'chat') {
      const c = state.data.chats.find(c => c.id === id);
      openModal('Conversa da viagem', '<p class="settings-note">Consulta administrativa · últimas 100 mensagens.</p><div class="messages">Carregando mensagens…</div>', c);
      const display = messages => { const target = document.querySelector('dialog .messages'); if (target) target.innerHTML = messages.map(m => `<div class="message"><strong>${esc(person(m.senderId))}</strong><p>${esc(m.text)}</p><small>${dateLabel(m.sentAt)}</small></div>`).join('') || empty('Conversa sem mensagens.'); };
      if (demo) display(c.messages || []); else stopMessages = backend.subscribeMessages(id, display, error => { const target = document.querySelector('dialog .messages'); if (target) target.replaceChildren(); showError(error); });
    }
    if (action === 'logout') await runBusy(() => backend.logout());
    if (action === 'reset') openModal('Restaurar demonstração', `<p>As alterações demonstrativas deste navegador serão substituídas pelos exemplos iniciais.</p><div class="modal-actions">${button('close', 'Voltar')}${button('confirm-reset', 'Restaurar exemplos', '', 'button primary')}</div>`);
    if (action === 'confirm-reset' && demo) { const data = seedData(); persistDemo(data); state.data = data; closeModal(); render(); toast('Demonstração restaurada.'); }
    if (action === 'help') openModal('Como usar sua central', '<div class="help-content"><h3>Do cadastro à primeira viagem</h3><ol><li>Em <strong>Solicitações</strong>, aprove ou recuse os candidatos.</li><li>Em <strong>Motoristas</strong>, configure trajeto, tarifa e vagas.</li><li>Em <strong>Viagens</strong>, acompanhe as reservas e atualize o status.</li><li>Use busca, filtros e <strong>Exportar relatório</strong> para consultar os registros.</li></ol></div>');
  } catch (error) { showError(error); }
});
async function boot() {
  navigate(location.hash.slice(1));
  if (demo || !configured) { state.loading = false; render(); return; }
  try {
    backend = await import('./firebase.js'); render();
    backend.watchSession(async user => {
      const generation = ++sessionGeneration;
      stopData?.(); stopAccess?.(); closeModal(); state.user = null; state.data = emptyData(); state.error = ''; render();
      if (!user) return;
      try {
        await backend.ensureAdminProfile();
        if (generation !== sessionGeneration) return;
        state.user = user; startData();
        const denied = error => {
          if (generation !== sessionGeneration) return;
          ++sessionGeneration; stopData?.(); stopAccess?.(); closeModal();
          state.user = null; state.data = emptyData(); state.loading = false;
          state.error = error ? errorMessage(error) : 'Seu acesso administrativo foi desativado.'; render();
        };
        stopAccess = backend.watchAdminAccess(active => { if (!active) denied(); }, denied);
      } catch (error) { if (generation === sessionGeneration) showError(error); }
    });
  } catch (error) { state.error = 'Não foi possível carregar o Firebase. Confira a conexão e a configuração do projeto.'; render(); }
}
void boot();
