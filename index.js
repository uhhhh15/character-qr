(async () => {
    "use strict";

    // --- 1. 常量与配置 ---
    const SCRIPT_NAME = '[QR Sync V1.6 - The Double Check]';
    const METADATA_KEY = 'QuickReply_Profile_V54';
    
    const QR_SETTINGS_PANEL_CONTENT_SELECTOR = "#qr--settings > div > div.inline-drawer-content";
    const EXTENSIONS_PANEL_SELECTOR = "#rm_extensions_block"; // 父级面板选择器

    let settingsPanelObserver = null;
    let extensionsPanelObserver = null; // 用于监听父级面板的观察者
    let isApplyingProfile = false;
    let isSyncPending = false;

    // --- 2. 辅助函数 ---
    async function waitForElement(selector, timeout = 15000) { return new Promise((resolve, reject) => { const i=setInterval(()=>{ const e=window.parent.document.querySelector(selector); if(e){clearInterval(i);clearTimeout(t);resolve(e);}},100); const t=setTimeout(()=>{clearInterval(i);reject(new Error(`Element "${selector}" not found`));},timeout); }); }
    function debounce(func, wait) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; }

    // --- 3. 核心功能 (无变化) ---
    function getProfileFromApi() { try { const q = window.parent.quickReplyApi; if (!q?.settings?.chatConfig?.setList) return null; return { profileData: q.settings.chatConfig.setList.filter(link => link?.set?.name).map(link => ({ name: link.set.name, isVisible: link.isVisible })) }; } catch (e) { return null; } }
    function loadProfileFromMetadata(characterId) { if (characterId === undefined || characterId === null) return null; const character = SillyTavern.characters[characterId]; if (character && character.data && character.data.extensions) { return character.data.extensions[METADATA_KEY] || null; } return null; }
    async function saveProfileToMetadata(characterId, profileData) { if (characterId === undefined || characterId === null) return; try { await SillyTavern.writeExtensionField(characterId, METADATA_KEY, profileData); await (TavernHelper?.builtin?.saveCharacterDebounced || SillyTavern.saveSettingsDebounced)(); } catch (error) { /* Silent */ } }
    async function applyProfileToCurrentChat(profile) { if (isApplyingProfile) return; isApplyingProfile = true; const q = window.parent.quickReplyApi; try { const currentSets = [...(q.settings.chatConfig.setList || [])]; for (const set of currentSets) await q.removeChatSet(set.set.name); await new Promise(r => setTimeout(r, 50)); if (profile && profile.profileData && profile.profileData.length > 0) { for (const set of profile.profileData) await q.addChatSet(set.name, set.isVisible); } q.settings.chatConfig.update(); } catch(e) { /* Silent */ } finally { setTimeout(() => { isApplyingProfile = false; }, 200); } }

    // --- 4. 状态管理与事件处理 ---
    const debouncedForceSave = debounce(async () => {
        if(isApplyingProfile) return;
        const currentState = getProfileFromApi();
        if(!currentState) return;
        const currentCharData = TavernHelper.getCharData();
        if (!currentCharData || !currentCharData.avatar) return;
        const characterIndex = SillyTavern.characters.findIndex(char => char.avatar === currentCharData.avatar);
        if (characterIndex === -1) return;
        await saveProfileToMetadata(characterIndex, currentState.profileData);
    }, 300);

    // 处理父级面板关闭的回调
    function handleExtensionsPanelCollapse(mutations) {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                if (mutation.target.classList.contains('closedDrawer')) {
                    debouncedForceSave();
                    return;
                }
            }
        }
    }

    // 处理QR设置面板的回调，现在它同时管理父级面板的监听器
	function handleSettingsPanelCollapse(mutations) {
		for (const mutation of mutations) {
			if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                const qrPanel = mutation.target;
                // 当QR面板关闭时
				if (qrPanel.style.display === 'none') {
					debouncedForceSave();
                    // 停止监听父级面板
                    if (extensionsPanelObserver) {
                        extensionsPanelObserver.disconnect();
                        extensionsPanelObserver = null;
                    }
					return;
                }
                // 当QR面板打开时 (从 'none' 变为其他)
                else {
                    // 如果还没有监听父级面板，则开始监听
                    if (!extensionsPanelObserver) {
                        const extensionsPanel = window.parent.document.querySelector(EXTENSIONS_PANEL_SELECTOR);
                        if (extensionsPanel) {
                            extensionsPanelObserver = new MutationObserver(handleExtensionsPanelCollapse);
                            extensionsPanelObserver.observe(extensionsPanel, { attributes: true, attributeFilter: ['class'] });
                        }
                    }
                }
			}
		}
	}

    async function syncUiOnLoad() {
        const currentCharData = TavernHelper.getCharData();
        if (!currentCharData || !currentCharData.avatar) return;
        const characterIndex = SillyTavern.characters.findIndex(char => char.avatar === currentCharData.avatar);
        if (characterIndex === -1) return;
        try {
            const profileData = loadProfileFromMetadata(characterIndex);
            if (profileData) {
                await applyProfileToCurrentChat({ profileData });
            } else {
                const initialProfile = getProfileFromApi();
                if (initialProfile) {
                    await saveProfileToMetadata(characterIndex, initialProfile.profileData);
                }
            }
        } catch(e) { /* Silent */ }
    }

    // --- 5. 初始化 ---
    async function initialize() {
        try {
            const { eventSource, event_types } = SillyTavern;
            if (!eventSource || !TavernHelper) throw new Error("关键API未找到。");
            
            const settingsPanelContent = await waitForElement(QR_SETTINGS_PANEL_CONTENT_SELECTOR);
            // 监听QR面板的style变化，现在用它来控制两个保存触发器
            settingsPanelObserver = new MutationObserver(handleSettingsPanelCollapse);
            settingsPanelObserver.observe(settingsPanelContent, { attributes: true, attributeFilter: ['style'] });
            
            eventSource.on(event_types.CHAT_CHANGED, () => {
                if (isSyncPending) return;
                isSyncPending = true;
                eventSource.once(event_types.SETTINGS_UPDATED, () => {
                    setTimeout(() => {
                        syncUiOnLoad();
                        isSyncPending = false;
                    }, 50);
                });
            });

            const titleElement = window.parent.document.querySelector("#qr--chat > div.qr--head > div.qr--title");
            if (titleElement) titleElement.textContent = "角色快速回复集";
            
        } catch (error) { /* Silent */ }
    }
    
    initialize();
})();
