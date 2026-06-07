-- Add columns to email_log for draft email storage
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS html_body TEXT;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS text_body TEXT;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS attachment_names JSONB DEFAULT '[]';
