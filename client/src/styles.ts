// 设置页样式(DSH token 驱动)
export const STYLES_CSS =
        '.dsth-page{display:flex;flex-direction:column;gap:14px;max-width:760px}' +
        '.dsth-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:22px}' +
        '.dsth-sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}' +
        '.dsth-section{display:flex;flex-direction:column;gap:8px}' +
        '.dsth-section-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px;margin-top:4px}' +
        '.dsth-moderow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
        '.dsth-modechip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:4px 14px;font-size:12px;line-height:18px;cursor:pointer;font:inherit}' +
        '.dsth-modechip:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
        '.dsth-modechip-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}' +
        '.dsth-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}' +
        '.dsth-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px}' +
        '.dsth-card.dsth-selected{border-color:var(--dsw-alias-brand-primary)}' +
        '.dsth-card-name{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px;cursor:pointer}' +
        '.dsth-badge{color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:400}' +
        '.dsth-row{display:flex;gap:8px;align-items:center}' +
        '.dsth-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 10px;font-size:12px;line-height:18px;min-width:0;flex:1;font:inherit}' +
        '.dsth-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}' +
        '.dsth-textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 10px;font-size:12px;line-height:18px;font-family:var(--ds-font-family-code);resize:vertical;min-height:90px;width:100%}' +
        '.dsth-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer;flex:none;font:inherit}' +
        '.dsth-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
        '.dsth-btn:disabled{opacity:.5;cursor:default}' +
        '.dsth-list{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto}' +
        '.dsth-listitem{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;display:flex;gap:8px;align-items:center;font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-1)}' +
        '.dsth-listitem-main{min-width:0;flex:1;display:flex;flex-direction:column}' +
        '.dsth-listitem-name{color:var(--dsw-alias-label-primary)}' +
        '.dsth-searchitem{gap:10px}' +
        '.dsth-ext-icon{width:28px;height:28px;border-radius:8px;flex:none;object-fit:cover}' +
        '.dsth-ext-click{cursor:pointer}' +
        '.dsth-ext-click:hover{text-decoration:underline}' +
        '.dsth-ext-desc{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
        '.dsth-ext-links{display:flex;gap:6px;margin-top:2px}' +
        '.dsth-tip-link{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:2px 8px;font-size:11px;line-height:16px;cursor:pointer;font:inherit}' +
        '.dsth-tip-link:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
        '.dsth-listitem-path{color:var(--dsw-alias-label-caption);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.dsth-msg{padding:6px 10px;border-radius:8px;font-size:12px;line-height:18px}' +
        '.dsth-msg-ok{color:var(--dsw-alias-state-success-primary)}' +
        '.dsth-msg-error{color:var(--dsw-alias-state-error-primary)}' +
        '.dsth-del{border:none;background:transparent;color:var(--dsw-alias-state-error-primary);cursor:pointer;font-size:11px;line-height:16px;padding:2px 6px;border-radius:6px;flex:none;font:inherit}' +
        '.dsth-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}' +
        '.dsth-foot{display:flex;align-items:center;gap:12px;padding-top:6px}' +
        '.dsth-note{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}' +
        '.dsth-ball-slot{width:36px;height:36px;flex:none;display:flex;align-items:center;justify-content:center}' +
        '.dsth-ball{width:20px;height:20px;border-radius:50%;display:inline-block;cursor:pointer;border:none;padding:0;transition:width .15s ease,height .15s ease;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.10),0 1px 2px rgba(0,0,0,0.08)}' +
        '.dsth-ball-dark{box-shadow:inset 0 0 0 1px rgba(255,255,255,0.14),0 1px 2px rgba(0,0,0,0.18)}' +
        '.dsth-ball-active{width:32px;height:32px}' +
        '.dsth-balls{display:flex;gap:6px;align-items:center;overflow-x:auto;flex:1;min-width:0;padding:2px 0;scrollbar-width:none}' +
        '.dsth-balls::-webkit-scrollbar{display:none}' +
        '.dsth-nav{flex:none;width:20px;height:20px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);background-color:var(--dsw-alias-bg-layer-2);background-repeat:no-repeat;background-position:center;background-size:10px 10px;cursor:pointer;padding:0;font-size:0}' +
        '.dsth-nav-l{background-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2381858C%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M15 18l-6-6 6-6%22/%3E%3C/svg%3E")}' +
        '.dsth-nav-r{background-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2381858C%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M9 6l6 6-6 6%22/%3E%3C/svg%3E")}' +
        '.dsth-nav:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}' +
        '.dsth-nav-disabled{opacity:.3;cursor:default}' +
        '.dsth-vrow{display:flex;gap:6px;align-items:center}' +
        '.dsth-vlabel{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;flex:none;width:28px}' +

        '.dsth-pair{display:flex;gap:8px;align-items:center}' +
        '.dsth-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
