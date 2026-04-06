package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Storage - потокобезопасное хранилище
type URLStore struct {
	mu    sync.RWMutex
	urls  map[string]string
	stats map[string]int64
}

var store = URLStore{
	urls:  make(map[string]string),
	stats: make(map[string]int64),
}

const (
	charset              = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	defaultLettersLength = 6
)

type Response struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Data    any    `json:"data,omitempty"`
	Error   string `json:"error,omitempty"`
}

type ShortenRequest struct {
	URL string `json:"url"`
}

type ShortenResponse struct {
	ShortCode   string `json:"shortCode"`
	ShortURL    string `json:"shortUrl"`
	OriginalURL string `json:"originalUrl"`
	CreatedAt   int64  `json:"createdAt"`
}

type StatsResponse struct {
	ShortCode   string `json:"shortCode"`
	OriginalURL string `json:"originalUrl"`
	Clicks      int64  `json:"clicks"`
}

func init() {
	rand.Seed(time.Now().UnixNano())
}

func randomLetters(n int) string {
	var sb strings.Builder
	for i := 0; i < n; i++ {
		randomIndex := rand.Intn(len(charset))
		sb.WriteByte(charset[randomIndex])
	}
	return sb.String()
}

func generateUniqueCode() string {
	for {
		code := randomLetters(defaultLettersLength)
		store.mu.RLock()
		_, exists := store.urls[code]
		store.mu.RUnlock()
		if !exists {
			return code
		}
	}
}

// CORS middleware
func enableCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "3600")
		
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		
		next(w, r)
	}
}

// shortenHandler - создание короткой ссылки
func shortenHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ShortenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.URL == "" {
		sendJSONError(w, "URL is required", http.StatusBadRequest)
		return
	}

	// Добавляем https если нет протокола
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		req.URL = "https://" + req.URL
	}

	// Простая валидация URL
	if !isValidURL(req.URL) {
		sendJSONError(w, "Invalid URL format", http.StatusBadRequest)
		return
	}

	shortCode := generateUniqueCode()

	store.mu.Lock()
	store.urls[shortCode] = req.URL
	store.stats[shortCode] = 0
	store.mu.Unlock()

	// Определяем базовый URL сервера
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	baseURL := fmt.Sprintf("%s://%s", scheme, r.Host)
	
	response := ShortenResponse{
		ShortCode:   shortCode,
		ShortURL:    fmt.Sprintf("%s/%s", baseURL, shortCode),
		OriginalURL: req.URL,
		CreatedAt:   time.Now().Unix(),
	}

	sendJSONSuccess(w, response, http.StatusCreated)
}

// redirectHandler - редирект по короткой ссылке
func redirectHandler(w http.ResponseWriter, r *http.Request) {
	// Получаем код из URL path
	path := strings.TrimPrefix(r.URL.Path, "/")
	
	// Пропускаем api запросы
	if strings.HasPrefix(path, "api/") || path == "health" {
		http.NotFound(w, r)
		return
	}
	
	if path == "" {
		// Если корневой путь, показываем информацию
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`
			<html>
				<head><title>Crisp URL Shortener API</title></head>
				<body style="font-family: sans-serif; max-width: 800px; margin: 50px auto; padding: 20px;">
					<h1>✨ Crisp URL Shortener</h1>
					<p>API сервер работает успешно!</p>
					<h2>Доступные эндпоинты:</h2>
					<ul>
						<li><strong>POST /api/shorten</strong> - создать короткую ссылку</li>
						<li><strong>GET /api/stats</strong> - получить всю статистику</li>
						<li><strong>GET /api/stats/{code}</strong> - статистика по ссылке</li>
						<li><strong>GET /{code}</strong> - переход по короткой ссылке</li>
						<li><strong>GET /health</strong> - проверка здоровья сервера</li>
					</ul>
					<p>📝 Используйте фронтенд приложение для работы с сервисом</p>
				</body>
			</html>
		`))
		return
	}

	store.mu.RLock()
	originalURL, exists := store.urls[path]
	store.mu.RUnlock()

	if !exists {
		sendJSONError(w, "Short URL not found", http.StatusNotFound)
		return
	}

	// Увеличиваем счетчик кликов
	store.mu.Lock()
	store.stats[path]++
	store.mu.Unlock()

	// Логируем переход
	fmt.Printf("🔗 Редирект: %s -> %s (всего переходов: %d)\n", path, originalURL, store.stats[path])

	http.Redirect(w, r, originalURL, http.StatusFound)
}

// getStatsHandler - статистика по конкретной ссылке
func getStatsHandler(w http.ResponseWriter, r *http.Request) {
	// Извлекаем код из URL
	path := strings.TrimPrefix(r.URL.Path, "/api/stats/")
	
	if path == "" {
		getAllStatsHandler(w, r)
		return
	}

	store.mu.RLock()
	originalURL, exists := store.urls[path]
	clicks := store.stats[path]
	store.mu.RUnlock()

	if !exists {
		sendJSONError(w, "Short URL not found", http.StatusNotFound)
		return
	}

	response := StatsResponse{
		ShortCode:   path,
		OriginalURL: originalURL,
		Clicks:      clicks,
	}

	sendJSONSuccess(w, response, http.StatusOK)
}

// getAllStatsHandler - вся статистика
func getAllStatsHandler(w http.ResponseWriter, r *http.Request) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	
	stats := make([]StatsResponse, 0, len(store.urls))
	for code, url := range store.urls {
		stats = append(stats, StatsResponse{
			ShortCode:   code,
			OriginalURL: url,
			Clicks:      store.stats[code],
		})
	}
	
	sendJSONSuccess(w, stats, http.StatusOK)
}

// healthCheckHandler - проверка здоровья
func healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	sendJSONSuccess(w, map[string]string{
		"status":    "healthy",
		"timestamp": time.Now().Format(time.RFC3339),
		"version":   "1.0.0",
	}, http.StatusOK)
}

// isValidURL - простая проверка URL
func isValidURL(urlStr string) bool {
	return len(urlStr) > 5 && (strings.Contains(urlStr, ".") || strings.Contains(urlStr, "localhost") || strings.Contains(urlStr, "127.0.0.1"))
}

func sendJSONSuccess(w http.ResponseWriter, data any, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(Response{
		Success: true,
		Data:    data,
	}); err != nil {
		log.Printf("Error encoding JSON: %v", err)
	}
}

func sendJSONError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(Response{
		Success: false,
		Error:   message,
	})
}

func main() {
	// Регистрируем обработчики с CORS
	http.HandleFunc("/health", enableCORS(healthCheckHandler))
	http.HandleFunc("/api/shorten", enableCORS(shortenHandler))
	http.HandleFunc("/api/stats/", enableCORS(getStatsHandler))
	http.HandleFunc("/api/stats", enableCORS(getAllStatsHandler))
	http.HandleFunc("/", enableCORS(redirectHandler))

	port := ":8080"
	fmt.Printf("\n╔══════════════════════════════════════════════════╗\n")
	fmt.Printf("║         🚀 CRISP URL SHORTENER STARTED          ║\n")
	fmt.Printf("╠══════════════════════════════════════════════════╣\n")
	fmt.Printf("║  Server:    http://localhost%s                  ║\n", port)
	fmt.Printf("║  Status:    ✅ Running                           ║\n")
	fmt.Printf("╠══════════════════════════════════════════════════╣\n")
	fmt.Printf("║  📝 API Endpoints:                               ║\n")
	fmt.Printf("║  POST   /api/shorten  - Create short URL        ║\n")
	fmt.Printf("║  GET    /api/stats    - Get all stats           ║\n")
	fmt.Printf("║  GET    /api/stats/*  - Get URL stats           ║\n")
	fmt.Printf("║  GET    /*            - Redirect                ║\n")
	fmt.Printf("║  GET    /health       - Health check            ║\n")
	fmt.Printf("╠══════════════════════════════════════════════════╣\n")
	fmt.Printf("║  💡 Open index.html in browser                   ║\n")
	fmt.Printf("║  📡 Waiting for requests...                      ║\n")
	fmt.Printf("╚══════════════════════════════════════════════════╝\n\n")
	
	log.Fatal(http.ListenAndServe(port, nil))
}