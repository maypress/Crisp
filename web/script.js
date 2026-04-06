// API Configuration
const API_BASE = 'http://localhost:8080';

// DOM Elements
const urlInput = document.getElementById('urlInput');
const shortenBtn = document.getElementById('shortenBtn');
const resultArea = document.getElementById('resultArea');
const errorArea = document.getElementById('errorArea');
const shortUrlDisplay = document.getElementById('shortUrlDisplay');
const copyBtn = document.getElementById('copyBtn');
const statsPreview = document.getElementById('statsPreview');
const statsSection = document.getElementById('statsSection');
const statsList = document.getElementById('statsList');
const refreshStatsBtn = document.getElementById('refreshStatsBtn');
const toast = document.getElementById('toast');
const errorMessageSpan = document.getElementById('errorMessage');

// State
let currentShortCode = null;

// Helper Functions
function showToast(message, isError = false) {
    if (!toast) return;
    toast.textContent = message || 'Unknown message';
    toast.style.background = isError ? 'rgba(239, 68, 68, 0.95)' : 'rgba(26, 29, 36, 0.95)';
    toast.classList.add('show');
    setTimeout(() => {
        if (toast) toast.classList.remove('show');
    }, 3000);
}

function hideResult() {
    if (resultArea) resultArea.style.display = 'none';
    if (errorArea) errorArea.style.display = 'none';
}

function showResult(shortUrl, shortCode, originalUrl) {
    if (!shortUrlDisplay) return;
    shortUrlDisplay.textContent = shortUrl || 'Error';
    currentShortCode = shortCode;
    if (resultArea) resultArea.style.display = 'block';
    if (errorArea) errorArea.style.display = 'none';
    
    if (originalUrl && statsPreview) {
        shortUrlDisplay.setAttribute('data-original', originalUrl);
        statsPreview.innerHTML = `<span>👁️ 0 просмотров</span>`;
    }
    
    if (resultArea) resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showError(message) {
    if (errorMessageSpan) errorMessageSpan.textContent = message || 'Unknown error';
    if (errorArea) errorArea.style.display = 'block';
    if (resultArea) resultArea.style.display = 'none';
}

function setLoading(isLoading) {
    if (!shortenBtn) return;
    if (isLoading) {
        shortenBtn.classList.add('loading');
        shortenBtn.innerHTML = '<span class="loading-spinner"></span><span>Сокращение...</span>';
        shortenBtn.disabled = true;
    } else {
        shortenBtn.classList.remove('loading');
        shortenBtn.innerHTML = '<span>✨</span><span>Сократить</span>';
        shortenBtn.disabled = false;
    }
}

// Add loading spinner style if not exists
if (!document.querySelector('#loading-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'loading-spinner-style';
    style.textContent = `
        .loading-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            display: inline-block;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
}

// API Calls
async function shortenUrl(url) {
    if (!url || typeof url !== 'string' || url.trim() === '') {
        throw new Error('URL is required');
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
        const response = await fetch(`${API_BASE}/api/shorten`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ url: url.trim() }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
                // Ignore JSON parsing error
            }
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        if (!data || !data.success) {
            throw new Error(data?.error || 'Unknown error occurred');
        }
        
        if (!data.data || !data.data.shortCode) {
            throw new Error('Invalid response from server');
        }
        
        return data.data;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Сервер не отвечает. Попробуйте позже');
        }
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            throw new Error('❌ Сервер не запущен. Запустите сервер командой: go run main.go');
        }
        throw error;
    }
}

async function getStats(shortCode) {
    if (!shortCode) return null;
    
    try {
        const response = await fetch(`${API_BASE}/api/stats/${shortCode}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data?.success ? data.data : null;
    } catch (error) {
        console.error('Error fetching stats:', error);
        return null;
    }
}

async function getAllStats() {
    try {
        const response = await fetch(`${API_BASE}/api/stats`);
        if (!response.ok) return [];
        const data = await response.json();
        return data?.success ? (data.data || []) : [];
    } catch (error) {
        console.error('Error fetching all stats:', error);
        return [];
    }
}

async function updateStatsDisplay() {
    try {
        const stats = await getAllStats();
        if (stats && stats.length > 0) {
            if (statsSection) statsSection.style.display = 'block';
            renderStatsList(stats);
        } else {
            if (statsSection) statsSection.style.display = 'none';
        }
    } catch (error) {
        console.error('Error updating stats display:', error);
    }
}

function renderStatsList(stats) {
    if (!statsList) return;
    
    if (!stats || stats.length === 0) {
        statsList.innerHTML = '<div class="stat-item">Пока нет созданных ссылок</div>';
        return;
    }
    
    statsList.innerHTML = stats.slice(0, 10).map(stat => {
        const shortCode = stat.shortCode || 'unknown';
        const originalURL = stat.originalURL || '';
        const clicks = stat.clicks || 0;
        return `
            <div class="stat-item">
                <div class="stat-info">
                    <div class="stat-code">/${escapeHtml(shortCode)}</div>
                    <div class="stat-url" title="${escapeHtml(originalURL)}">${escapeHtml(truncateUrl(originalURL, 50))}</div>
                </div>
                <div class="stat-clicks">👁️ ${clicks}</div>
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncateUrl(url, maxLength) {
    if (!url) return '';
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
}

// Event Handlers
async function handleShorten() {
    // Get and validate URL
    let url = '';
    if (urlInput) {
        url = urlInput.value;
    }
    
    // Check if url is defined and not empty
    if (!url || typeof url !== 'string') {
        showError('Пожалуйста, введите ссылку');
        return;
    }
    
    url = url.trim();
    if (url === '') {
        showError('Пожалуйста, введите ссылку');
        return;
    }
    
    // Hide previous results
    hideResult();
    setLoading(true);
    
    try {
        // Add https:// if no protocol specified
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        const result = await shortenUrl(url);
        
        if (!result || !result.shortUrl) {
            throw new Error('Сервер вернул некорректный ответ');
        }
        
        showResult(result.shortUrl, result.shortCode, result.originalUrl);
        showToast('✅ Ссылка успешно сокращена!');
        
        // Update stats display
        await updateStatsDisplay();
        
        // Get and display stats for this link
        if (result.shortCode) {
            const stats = await getStats(result.shortCode);
            if (stats && statsPreview) {
                const clicks = stats.clicks || 0;
                statsPreview.innerHTML = `<span>👁️ ${clicks} ${getClicksText(clicks)}</span>`;
            }
        }
        
        // Clear input
        if (urlInput) urlInput.value = '';
        
    } catch (error) {
        console.error('Shorten error:', error);
        const errorMessage = error.message || 'Неизвестная ошибка';
        showError(errorMessage);
        showToast(errorMessage, true);
    } finally {
        setLoading(false);
    }
}

function getClicksText(clicks) {
    if (typeof clicks !== 'number') return 'просмотров';
    const lastDigit = clicks % 10;
    const lastTwo = clicks % 100;
    if (lastTwo >= 11 && lastTwo <= 19) return 'просмотров';
    if (lastDigit === 1) return 'просмотр';
    if (lastDigit >= 2 && lastDigit <= 4) return 'просмотра';
    return 'просмотров';
}

async function handleCopy() {
    if (!shortUrlDisplay) return;
    
    const shortUrl = shortUrlDisplay.textContent;
    if (!shortUrl || shortUrl === '—' || shortUrl === 'Error') {
        showToast('Нет ссылки для копирования', true);
        return;
    }
    
    try {
        await navigator.clipboard.writeText(shortUrl);
        showToast('📋 Скопировано в буфер обмена!');
        
        if (copyBtn) {
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '<span>✓</span><span>Скопировано!</span>';
            setTimeout(() => {
                if (copyBtn) copyBtn.innerHTML = originalText;
            }, 2000);
        }
    } catch (err) {
        console.error('Copy error:', err);
        showToast('Не удалось скопировать. Скопируйте вручную', true);
    }
}

async function handleRefreshStats() {
    await updateStatsDisplay();
    showToast('Статистика обновлена');
}

// Check server health
async function checkServer() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch(`${API_BASE}/health`, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            console.log('✅ Сервер доступен');
            showToast('✅ Сервер подключен', false);
        } else {
            console.warn('⚠️ Сервер отвечает с ошибкой');
            showToast('⚠️ Сервер отвечает с ошибкой', true);
        }
    } catch (error) {
        console.error('❌ Сервер не доступен:', error);
        showToast('⚠️ Сервер не запущен. Запустите: go run main.go', true);
    }
}

// Initialize event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM загружен, инициализация приложения...');
    
    // Add event listeners only if elements exist
    if (shortenBtn) {
        shortenBtn.addEventListener('click', handleShorten);
        console.log('✓ Кнопка сокращения инициализирована');
    } else {
        console.error('❌ Кнопка shortenBtn не найдена');
    }
    
    if (copyBtn) {
        copyBtn.addEventListener('click', handleCopy);
        console.log('✓ Кнопка копирования инициализирована');
    }
    
    if (refreshStatsBtn) {
        refreshStatsBtn.addEventListener('click', handleRefreshStats);
        console.log('✓ Кнопка обновления статистики инициализирована');
    }
    
    if (urlInput) {
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleShorten();
            }
        });
        console.log('✓ Поле ввода инициализировано');
    }
    
    // Initial load
    checkServer();
    updateStatsDisplay();
    
    // Auto-refresh stats every 30 seconds
    setInterval(updateStatsDisplay, 30000);
});

// Log any errors globally
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

console.log('Скрипт загружен, ожидаем загрузки DOM...');