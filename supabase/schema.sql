-- Create Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT auth.uid(),
    display_name TEXT NOT NULL,
    line_user_id TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own data
CREATE POLICY "Users can view own data" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own data" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own data" ON users FOR INSERT WITH CHECK (auth.uid() = id);

-- Create Books table
CREATE TABLE IF NOT EXISTS books (
    book_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread', -- 'unread', 'reading', 'completed', 'insulted'
    insult_level INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for books
ALTER TABLE books ENABLE ROW LEVEL SECURITY;

-- Books policies: users can manage their own books
CREATE POLICY "Users can view own books" ON books FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own books" ON books FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own books" ON books FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own books" ON books FOR DELETE USING (auth.uid() = user_id);

-- Create index on user_id for performance
CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id);
CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
CREATE INDEX IF NOT EXISTS idx_books_deadline ON books(deadline);
