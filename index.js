(async () => {
    "ust strict";

    // --- 1. 常量与配置 ---
    const SCRIPT_NAME = '[QR Sync V1 - The Certainty]';
    const METADATA_KEY = 'QuickReply_Profile_V54';
    
    const parentToastr = window.parent.toastr;
    const QR_SETTINGS_PANEL_CONTENT_SELECTOR = "#qr--settings > div > div.inline-drawer-content";

    let settingsPanelObserver = null;
    let isApplyingProfile = false;

    // --- 2. 辅助函数 ---
    async function waitForElement(selector, timeout = 15000) { return new Promise((resolve, reject) => { const i=setInterval(()=>{ const e=window.parent.document.querySelector(selector); if(e){clearInterval(i);clearTimeout(t);resolve(e);}},100); const t=setTimeout(()=>{clearInterval(i);reject(new Error(`Element "${selector}" not found`));},timeout); }); }
    function debounce(func, wait) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; }

    // --- 3. 核心功能 (无变化) ---
    function getProfileFromApi() { try { const q = window.parent.quickReplyApi; if (!q?.settings?.chatConfig?.setList) return null; return { profileData: q.settings.chatConfig.setList.filter(link => link?.set?.name).map(link => ({ name: link.set.name, isVisible: link.isVisible })) }; } catch (e) { return null; } }
    function loadProfileFromMetadata(characterId) { if (characterId === undefined || characterId === null) return null; const character = SillyTavern.characters[characterId]; if (character && character.data && character.data.extensions) { return character.data.extensions[METADATA_KEY] || null; } return null; }
    async function saveProfileToMetadata(characterId, profileData) { if (characterId === undefined || characterId === null) return; try { await SillyTavern.writeExtensionField(characterId, METADATA_KEY, profileData); await (TavernHelper?.builtin?.saveCharacterDebounced || SillyTavern.saveSettingsDebounced)(); } catch (error) { /* Silent */ } }
    async function applyProfileToCurrentChat(profile) { if (isApplyingProfile) return; isApplyingProfile = true; const q = window.parent.quickReplyApi; try { const currentSets = [...(q.settings.chatConfig.setList || [])]; for (const set of currentSets) await q.removeChatSet(set.set.name); await new Promise(r => setTimeout(r, 50)); if (profile && profile.profileData && profile.profileData.length > 0) { for (const set of profile.profileData) await q.addChatSet(set.name, set.isVisible); } q.settings.chatConfig.update(); } catch(e) { /* Silent */ } finally { setTimeout(() => { isApplyingProfile = false; }, 200); } }

    // --- 4. 状态管理与事件处理 ---
    async function forceSaveProfileFromUI() { if(isApplyingProfile) return; const currentState = getProfileFromApi(); if(!currentState) return; const currentCharData = TavernHelper.getCharData(); if (!currentCharData || !currentCharData.avatar) return; const characterIndex = SillyTavern.characters.findIndex(char => char.avatar === currentCharData.avatar); if (characterIndex === -1) return; await saveProfileToMetadata(characterIndex, currentState.profileData); }
	
	function handleSettingsPanelCollapse(mutations) {
		for (const mutation of mutations) {
			if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
				const targetElement = mutation.target;
				if (targetElement.style.display === 'none') {
					forceSaveProfileFromUI();
					return; 
				}
			}
		}
	}

    async function syncUiOnLoad(reason) {
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
                if (initialProfile && initialProfile.profileData.length > 0) {
                    await saveProfileToMetadata(characterIndex, initialProfile.profileData);
                    await applyProfileToCurrentChat(initialProfile);
                } else {
                    await applyProfileToCurrentChat(null);
                }
            }
        } catch(e) { /* Silent */ }
    }

    // --- 5. 初始化 ---
    async function initialize() {
        try {
            const { eventSource, event_types } = SillyTavern;
            if (!eventSource || !TavernHelper || typeof TavernHelper.getCharData !== 'function') throw new Error("关键API未找到。");
            
            const settingsPanelContent = await waitForElement(QR_SETTINGS_PANEL_CONTENT_SELECTOR);
            settingsPanelObserver = new MutationObserver(debounce(handleSettingsPanelCollapse, 300));
            settingsPanelObserver.observe(settingsPanelContent, { attributes: true, attributeFilter: ['style'] });
            
            const debouncedSyncForChatChange = debounce(() => {
                const titleElement = window.parent.document.querySelector("#qr--chat > div.qr--head > div.qr--title");
                if (titleElement) {
                    titleElement.textContent = "角色快速回复集";
                }
                syncUiOnLoad('CHAT_CHANGED');
            }, 400);

            // 【核心修正】采用您提供的、绝对正确的两步事件监听法
            eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => {
                // 注册一个一次性的监听器，等待“绿灯”信号
                eventSource.once(event_types.SETTINGS_UPDATED, () => {
                     // 等待一个极短的延迟，确保DOM渲染完成
                    setTimeout(() => syncUiOnLoad('SETTINGS_UPDATED after char load'), 50);
                });
            });

            // 对于同角色内的聊天切换，简单的防抖依然是合适的
            eventSource.on(event_types.CHAT_CHANGED, debouncedSyncForChatChange);
            
            // 首次加载时，直接调用一次以确保初始状态正确
            await syncUiOnLoad('INITIAL_LOAD'); 
            
        } catch (error) { /* Silent */ }
    }
    
    initialize();

})();
