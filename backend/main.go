package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"time"

	"github.com/supabase-community/supabase-go"
)

var supabaseClient *supabase.Client

type LineAuthRequest struct {
	LineAccessToken string `json:"lineAccessToken"`
	LineUserID      string `json:"lineUserID"`
}

// Book は書籍データを表す構造体 (Supabase/PostgreSQL用)
type Book struct {
	BookID      string    `json:"bookId" db:"book_id"`
	UserID      string    `json:"userId" db:"user_id"`
	Title       string    `json:"title" db:"title"`
	Author      string    `json:"author" db:"author"`
	Deadline    time.Time `json:"deadline" db:"deadline"`
	Status      string    `json:"status" db:"status"`
	InsultLevel int       `json:"insultLevel" db:"insult_level"`
	CreatedAt   time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time `json:"updatedAt" db:"updated_at"`
}

func main() {
	// Supabase クライアントの初期化
	supabaseURL := os.Getenv("SUPABASE_URL")
	supabaseKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")

	if supabaseURL == "" || supabaseKey == "" {
		log.Fatalf("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set")
	}

	var err error
	supabaseClient, err = supabase.NewClient(supabaseURL, supabaseKey, nil)
	if err != nil {
		log.Fatalf("cannot initialize supabase client: %v", err)
	}

	http.HandleFunc("/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Hello from Backend (Supabase Edition)!")
	}))

	http.HandleFunc("/health", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, "OK")
	}))

	http.HandleFunc("/api/auth/line", corsMiddleware(handleLineAuth))
	http.HandleFunc("/api/books", corsMiddleware(handleBooks))
	http.HandleFunc("/api/books/complete", corsMiddleware(handleCompleteBook))
	http.HandleFunc("/api/cron/check", corsMiddleware(handleCheckDeadlines))

	rand.Seed(time.Now().UnixNano())

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	fmt.Printf("Server starting on port %s...\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

func handleLineAuth(w http.ResponseWriter, r *http.Request) {
	var req LineAuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	resp, _, err := supabaseClient.From("users").Select("*", "exact", false).Eq("line_user_id", req.LineUserID).Execute()
	if err != nil {
		log.Printf("[ERROR] handleLineAuth query error: %v", err)
		http.Error(w, fmt.Sprintf("failed to query user: %v", err), http.StatusInternalServerError)
		return
	}

	var results []map[string]interface{}
	json.Unmarshal(resp, &results)

	if len(results) == 0 {
		newUser := map[string]interface{}{
			"line_user_id": req.LineUserID,
			"display_name": "LINE User",
		}
		_, _, err = supabaseClient.From("users").Insert(newUser, false, "", "", "").Execute()
		if err != nil {
			log.Printf("[ERROR] handleLineAuth insert error: %v", err)
			http.Error(w, fmt.Sprintf("failed to create user: %v", err), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Auth pre-check successful"})
}

func handleBooks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handleGetBooks(w, r)
	case http.MethodPost:
		handleRegisterBook(w, r)
	case http.MethodPut:
		handleUpdateBook(w, r)
	case http.MethodDelete:
		handleDeleteBook(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleGetBooks(w http.ResponseWriter, r *http.Request) {
	userId := r.URL.Query().Get("userId")
	if userId == "" {
		http.Error(w, "userId required", http.StatusBadRequest)
		return
	}

	resp, _, err := supabaseClient.From("books").Select("*", "exact", false).Eq("user_id", userId).Execute()
	if err != nil {
		log.Printf("[ERROR] handleGetBooks error: %v", err)
		http.Error(w, fmt.Sprintf("failed to fetch books: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(resp)
}

func handleRegisterBook(w http.ResponseWriter, r *http.Request) {
	var book Book
	if err := json.NewDecoder(r.Body).Decode(&book); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if book.Title == "" || book.Author == "" || book.UserID == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	if book.Status == "" {
		book.Status = "unread"
	}

	insertData := map[string]interface{}{
		"user_id":      book.UserID,
		"title":        book.Title,
		"author":       book.Author,
		"deadline":     book.Deadline,
		"status":       book.Status,
		"insult_level": book.InsultLevel,
	}

	_, _, err := supabaseClient.From("books").Insert(insertData, false, "", "", "").Execute()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to register book: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "Book registered successfully"})
}

func handleUpdateBook(w http.ResponseWriter, r *http.Request) {
	var book Book
	if err := json.NewDecoder(r.Body).Decode(&book); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	updateData := map[string]interface{}{
		"title":        book.Title,
		"author":       book.Author,
		"deadline":     book.Deadline,
		"status":       book.Status,
		"insult_level": book.InsultLevel,
		"updated_at":   time.Now(),
	}

	_, _, err := supabaseClient.From("books").Update(updateData, "", "").Eq("book_id", book.BookID).Eq("user_id", book.UserID).Execute()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update book: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Book updated successfully"})
}

func handleDeleteBook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BookID string `json:"bookId"`
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	_, _, err := supabaseClient.From("books").Delete("", "").Eq("book_id", req.BookID).Eq("user_id", req.UserID).Execute()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to delete book: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Book deleted successfully"})
}

func handleCompleteBook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BookID string `json:"bookId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	_, _, err := supabaseClient.From("books").Update(map[string]interface{}{"status": "completed", "updated_at": time.Now()}, "", "").Eq("book_id", req.BookID).Execute()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to complete book: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Book marked as completed"})
}

func handleCheckDeadlines(w http.ResponseWriter, r *http.Request) {
	cronSecret := os.Getenv("CRON_SECRET")
	if cronSecret != "" && r.Header.Get("Authorization") != "Bearer "+cronSecret {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	resp, _, err := supabaseClient.From("books").
		Select("*", "exact", false).
		In("status", []string{"unread", "insulted"}).
		Lt("deadline", time.Now().Format(time.RFC3339)).
		Execute()
	if err != nil {
		http.Error(w, fmt.Sprintf("database error: %v", err), http.StatusInternalServerError)
		return
	}

	var books []Book
	json.Unmarshal(resp, &books)

	count := 0
	for _, book := range books {
		insultMsg, _ := generateInsult(book)

		uResp, _, err := supabaseClient.From("users").Select("line_user_id", "exact", false).Eq("id", book.UserID).Execute()
		if err == nil {
			var users []map[string]interface{}
			json.Unmarshal(uResp, &users)
			if len(users) > 0 {
				lineUserID := users[0]["line_user_id"].(string)
				if err := sendLineMessage(lineUserID, insultMsg); err == nil {
					supabaseClient.From("books").Update(map[string]interface{}{"status": "insulted"}, "", "").Eq("book_id", book.BookID).Execute()
					count++
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Checked deadlines. Found %d expired books.", count)})
}

func generateInsult(book Book) (string, error) {
	insultMessages := []string{
		"その本、まだ読んでないんですか？時間の無駄ですね。",
		"積読ですか。残念ですね。その本は二度と読まれないでしょう。",
		"知識は鮮度が命。その本はもう腐っています。",
		fmt.Sprintf("「%s」を読むというタスクは、あなたの優先順位リストに存在しないようですね。", book.Title),
		"あなたの本棚、もはや墓場ですね。未完の志が眠る場所。",
	}
	randomIndex := rand.Intn(len(insultMessages))
	return insultMessages[randomIndex], nil
}

func sendLineMessage(lineUserID, message string) error {
	accessToken := os.Getenv("LINE_CHANNEL_ACCESS_TOKEN")
	if accessToken == "" {
		return fmt.Errorf("LINE_CHANNEL_ACCESS_TOKEN is not set")
	}

	url := "https://api.line.me/v2/bot/message/push"
	requestBody, _ := json.Marshal(map[string]interface{}{
		"to": lineUserID,
		"messages": []interface{}{
			map[string]interface{}{"type": "text", "text": message},
		},
	})

	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(requestBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("LINE API error")
	}
	return nil
}
