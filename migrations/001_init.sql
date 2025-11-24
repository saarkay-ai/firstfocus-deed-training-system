-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'trainee',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create deeds table
CREATE TABLE IF NOT EXISTS deeds (
  id SERIAL PRIMARY KEY,
  filename TEXT,
  filepath TEXT,
  document_type TEXT,
  grantor TEXT,
  grantee TEXT,
  recording_date DATE,
  dated_date DATE,
  county_name TEXT,
  county_state TEXT,
  apn TEXT,
  recording_book TEXT,
  recording_page TEXT,
  instrument_number TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create attempts table
CREATE TABLE IF NOT EXISTS attempts (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  deed_id INT REFERENCES deeds(id) ON DELETE SET NULL,
  grantor TEXT,
  grantee TEXT,
  recording_date DATE,
  dated_date DATE,
  document_type TEXT,
  county_name TEXT,
  county_state TEXT,
  apn TEXT,
  recording_book TEXT,
  recording_page TEXT,
  instrument_number TEXT,
  total_score INT,
  time_taken_seconds INT,
  feedback JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
