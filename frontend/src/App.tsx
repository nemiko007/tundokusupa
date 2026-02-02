import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import liff from "@line/liff";
import LineAddFriendButton from './components/LineAddFriendButton';

interface LineUserProfile {
    userId: string;
    displayName: string;
    pictureUrl?: string;
    statusMessage?: string;
}

interface Book {
    title: string;
    author: string;
    deadline: string; // ISO String
    status: string;
    insult_level: number;
    user_id: string;
    book_id: string;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://tundoku-killer.onrender.com"; // 必要に応じて環境変数化

function App() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [lineProfile, setLineProfile] = useState<LineUserProfile | null>(null);
    const [supabaseUser, setSupabaseUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [books, setBooks] = useState<Book[]>([]);

    const [title, setTitle] = useState("");
    const [author, setAuthor] = useState("");
    const [deadline, setDeadline] = useState("");
    const [insultLevel, setInsultLevel] = useState(3);
    const [editingBookId, setEditingBookId] = useState<string | null>(null);

    useEffect(() => {
        const initializeLiffAndLogin = async () => {
            try {
                await liff.init({ liffId: import.meta.env.VITE_LIFF_ID });

                if (!liff.isLoggedIn()) {
                    liff.login();
                    return;
                }

                setIsLoggedIn(true);
                const lineAccessToken = liff.getAccessToken();
                const profile = await liff.getProfile();
                setLineProfile(profile);

                if (!lineAccessToken || !profile.userId) {
                    setError("Failed to get LINE access token or user ID.");
                    setLoading(false);
                    return;
                }

                // Supabase Authにサインイン (簡易的にパスワードなし、またはカスタムトークン的な扱いで)
                // 本来はSupabase Authのカスタムプロバイダーや匿名認証＋メタデータで管理
                // 今回は既存ロジックをリスペクトし、バックエンド経由でDB登録を行い、フロント側ではUserIDで動く
                // セキュリティ向上のためにはSupabase Authのセッションを確立させる必要がある

                // バックエンドでユーザーがいなければ作成させる
                const authResponse = await fetch(`${BACKEND_URL}/api/auth/line`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        lineAccessToken,
                        lineUserID: profile.userId,
                    }),
                });

                if (!authResponse.ok) {
                    const errorText = await authResponse.text();
                    console.error("Backend auth error details:", {
                        status: authResponse.status,
                        body: errorText
                    });
                    throw new Error(`Backend authentication failed (Status: ${authResponse.status}): ${errorText}`);
                }

                const authData = await authResponse.json();
                console.log("[DEBUG] Auth data received from backend (v1.0.1):", authData);

                // バックエンドから返ってきた内部UUIDをUserIDとして扱う
                console.log("[DEBUG] Setting supabaseUser.uid to:", authData.userId);
                setSupabaseUser({ uid: authData.userId });

                // 書籍リスト取得
                console.log("[DEBUG] Fetching books for userId:", authData.userId);
                await fetchBooks(authData.userId);
            } catch (err: any) {
                console.error("LIFF/Supabase login error:", err);
                setError(err.message || "An unexpected error occurred during login.");
            } finally {
                setLoading(false);
            }
        };

        initializeLiffAndLogin();
    }, []);

    const fetchBooks = async (userId: string) => {
        try {
            const response = await fetch(`${BACKEND_URL}/api/books?userId=${userId}`);
            if (response.ok) {
                const data = await response.json();
                setBooks(data || []);
            }
        } catch (err) {
            console.error("Failed to fetch books:", err);
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (!supabaseUser?.uid) {
            setError("User not logged in.");
            setLoading(false);
            return;
        }

        try {
            const bookData = {
                title,
                author,
                deadline: new Date(deadline).toISOString(),
                insult_level: Number(insultLevel),
                user_id: supabaseUser.uid,
                book_id: editingBookId || "",
                status: (editingBookId ? books.find(b => b.book_id === editingBookId)?.status : "unread") || "unread"
            };

            const method = editingBookId ? "PUT" : "POST";
            const response = await fetch(`${BACKEND_URL}/api/books`, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bookData),
            });

            if (!response.ok) {
                throw new Error(editingBookId ? "更新に失敗しました。" : "登録に失敗しました。");
            }

            const result = await response.json();
            alert(result.message);

            await fetchBooks(supabaseUser.uid);

            setTitle("");
            setAuthor("");
            setDeadline("");
            setInsultLevel(3);
            setEditingBookId(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleEditClick = (book: Book) => {
        setEditingBookId(book.book_id);
        setTitle(book.title);
        setAuthor(book.author);
        setDeadline(book.deadline.split('T')[0]);
        setInsultLevel(book.insult_level);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteClick = async (bookId: string) => {
        if (!confirm("本当にこの本を削除しちゃうの？🥺")) return;

        try {
            const response = await fetch(`${BACKEND_URL}/api/books`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ book_id: bookId, user_id: supabaseUser.uid }),
            });

            if (response.ok) {
                setBooks(prev => prev.filter(b => b.book_id !== bookId));
                alert("削除したよ！✨");
            }
        } catch (err) {
            alert("削除中にエラーが発生しました。");
        }
    };

    const handleCompleteClick = async (bookId: string) => {
        try {
            const response = await fetch(`${BACKEND_URL}/api/books/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ book_id: bookId }),
            });

            if (response.ok) {
                setBooks(prev => prev.map(b => b.book_id === bookId ? { ...b, status: "completed" } : b));
            }
        } catch (err) {
            console.error("読了処理エラー:", err);
        }
    };

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-400 to-indigo-600 text-white text-3xl font-bold animate-pulse">💖 Loading... 💖</div>;
    }

    if (error) {
        return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-500 to-pink-500 text-white text-2xl font-bold p-4 text-center">ぴえん🥺！エラーだよ！💦: {error}</div>;
    }

    const completedBooks = books.filter(b => b.status === "completed");
    const unreadBooks = books.filter(b => b.status !== "completed");

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-pink-400 via-purple-500 to-indigo-600 text-white">
            <h1 className="text-5xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-100 via-pink-200 to-purple-300 mb-8 drop-shadow-lg animate-pulse">ツンドク・キラー🔥</h1>
            <div className="mb-8"><LineAddFriendButton lineId="@566nverw" /></div>

            {isLoggedIn && supabaseUser ? (
                <div className="bg-pink-700 p-8 rounded-xl shadow-lg drop-shadow-md w-full max-w-md border-2 border-pink-300 transform transition-transform duration-300" style={{ boxShadow: '0 0 10px #ff00ff, 0 0 20px #ff00ff, 0 0 30px #ff00ff' }}>
                    <p className="text-2xl font-black text-pink-200 mb-4 text-center drop-shadow-md">💖ようこそ、{lineProfile?.displayName}さま！💖</p>
                    {lineProfile?.pictureUrl && (
                        <img src={lineProfile.pictureUrl} alt="Profile" className="w-28 h-28 rounded-full mx-auto mb-5 border-4 border-pink-300 shadow-md transform transition-transform duration-300 hover:scale-110" />
                    )}
                    <p className="text-purple-200 text-sm mb-6 text-center">Supabase移行、完了したよ！天才！✌️</p>

                    <h2 className="text-3xl font-black text-pink-200 mb-6 text-center drop-shadow-md">{editingBookId ? "💖書籍を修正するしかなくない？💖" : "💖書籍を登録するしかなくない？💖"}</h2>
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label htmlFor="title" className="block text-pink-100 text-base font-bold mb-2">タイトル:</label>
                            <input type="text" id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="shadow-lg appearance-none border-2 border-pink-300 rounded-lg w-full py-3 px-4 text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-400" required />
                        </div>
                        <div>
                            <label htmlFor="author" className="block text-pink-100 text-base font-bold mb-2">著者:</label>
                            <input type="text" id="author" value={author} onChange={(e) => setAuthor(e.target.value)} className="shadow-lg appearance-none border-2 border-pink-300 rounded-lg w-full py-3 px-4 text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-400" required />
                        </div>
                        <div>
                            <label htmlFor="deadline" className="block text-pink-100 text-base font-bold mb-2">読了期限:</label>
                            <input type="date" id="deadline" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="shadow-lg appearance-none border-2 border-pink-300 rounded-lg w-full py-3 px-4 text-gray-800" required />
                        </div>
                        <div>
                            <label htmlFor="insultLevel" className="block text-pink-100 text-base font-bold mb-2">煽りレベル:</label>
                            <select id="insultLevel" value={insultLevel} onChange={(e) => setInsultLevel(Number(e.target.value))} className="shadow-lg border-2 border-pink-300 rounded-lg w-full py-3 px-4 text-gray-800">
                                <option value={1}>1 (やさしく)</option>
                                <option value={2}>2 (ちょっと煽る)</option>
                                <option value={3}>3 (普通に煽る)</option>
                                <option value={4}>4 (かなり煽る)</option>
                                <option value={5}>5 (鬼煽り！)</option>
                            </select>
                        </div>
                        <div className="flex gap-4">
                            <button type="submit" className="bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-white font-black py-3 px-6 rounded-full flex-1 focus:outline-none shadow-xl uppercase tracking-wider">{editingBookId ? "💖修正を保存する💖" : "💖書籍を登録するしかなくない？！💖"}</button>
                            {editingBookId && <button type="button" onClick={() => setEditingBookId(null)} className="bg-gray-500 hover:bg-gray-400 text-white font-black py-3 px-6 rounded-full shadow-xl">キャンセル</button>}
                        </div>
                    </form>

                    <div className="mt-10 p-6 bg-pink-700 rounded-xl shadow-lg drop-shadow-md border-2 border-pink-300">
                        <h2 className="text-3xl font-black text-pink-200 mb-6 text-center drop-shadow-md">💖未読・読書中の本💖</h2>
                        {unreadBooks.length > 0 ? (
                            <ul className="space-y-6">
                                {unreadBooks.map((book) => (
                                    <li key={book.book_id} className="bg-purple-800 p-5 rounded-lg shadow-lg border-2 border-purple-400 transform transition-transform duration-300">
                                        <h3 className="text-xl font-black text-yellow-300 mb-1">{book.title}</h3>
                                        <p className="text-pink-100 text-sm">著者: {book.author}</p>
                                        <p className="text-purple-200 text-xs mt-1">期限: {new Date(book.deadline).toLocaleDateString()}</p>
                                        <p className={`text-sm font-black mt-2 uppercase ${book.status === "insulted" ? "text-red-400 animate-pulse" : "text-yellow-300"}`}>ステータス: {book.status === "unread" ? "未読" : book.status === "reading" ? "読書中" : book.status === "completed" ? "読了済" : "煽られ中"}</p>
                                        <div className="flex flex-wrap gap-2 mt-4">
                                            <button onClick={() => handleCompleteClick(book.book_id)} className="bg-gradient-to-r from-green-400 to-blue-500 text-white font-black py-2 px-4 rounded-full text-sm shadow-md">読了！天才じゃん！✌️</button>
                                            <button onClick={() => handleEditClick(book)} className="bg-yellow-500 text-white font-black py-2 px-4 rounded-full text-sm shadow-md">編集✨</button>
                                            <button onClick={() => handleDeleteClick(book.book_id)} className="bg-red-500 text-white font-black py-2 px-4 rounded-full text-sm shadow-md">削除🥺</button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-center text-pink-200 mt-4 text-lg font-bold">まだ登録された本はないみたい？🥺</p>}
                    </div>

                    <div className="mt-10 p-6 bg-pink-700 rounded-xl shadow-lg drop-shadow-md border-2 border-pink-300">
                        <h2 className="text-3xl font-black text-pink-200 mb-6 text-center drop-shadow-md">💖読了済みの本💖</h2>
                        {completedBooks.length > 0 ? (
                            <ul className="space-y-6">
                                {completedBooks.map((book) => (
                                    <li key={book.book_id} className="bg-green-800 p-5 rounded-lg shadow-lg border-2 border-green-400">
                                        <h3 className="text-xl font-black text-yellow-300 mb-1">{book.title}</h3>
                                        <p className="text-green-100 text-sm">著者: {book.author}</p>
                                        <p className="text-green-200 text-xs mt-1">読了日: {new Date(book.deadline).toLocaleDateString()}</p>
                                        <div className="flex gap-2 mt-4">
                                            <button onClick={() => handleEditClick(book)} className="bg-yellow-500 text-white font-black py-2 px-4 rounded-full text-sm shadow-md">編集✨</button>
                                            <button onClick={() => handleDeleteClick(book.book_id)} className="bg-red-500 text-white font-black py-2 px-4 rounded-full text-sm shadow-md">削除🥺</button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-center text-pink-200 mt-4 text-lg font-bold">まだ読了済みの本はないみたい？🥺</p>}
                    </div>
                </div>
            ) : (
                <div className="bg-purple-800 p-8 rounded-xl shadow-lg drop-shadow-md text-center border-2 border-purple-300" style={{ boxShadow: '0 0 10px #8a2be2, 0 0 20px #8a2be2, 0 0 30px #8a2be2' }}>
                    <p className="text-xl text-pink-200 mb-4 font-bold animate-pulse">まだLIFFにログインしてないよ〜🥺</p>
                    <button onClick={() => liff.login()} className="bg-pink-500 hover:bg-pink-400 text-white font-bold py-3 px-6 rounded-full shadow-lg text-lg">LINEでログインするしかなくない？💖</button>
                </div>
            )}
        </div>
    );
}

export default App;
