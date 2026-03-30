import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import pdf from 'pdf-parse';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const fileName = file.name;
    const documentId = crypto.randomUUID();
    const storagePath = `uploads/${documentId}/${fileName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    // Extract text based on file type
    let text = '';
    if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
      try {
        const pdfData = await pdf(buffer);
        text = pdfData.text;
      } catch (pdfErr) {
        console.error('PDF parse error:', pdfErr);
        text = '[PDF could not be parsed]';
      }
    } else {
      text = await file.text();
    }

    // Insert document record (matches actual DB schema)
    const { error: dbError } = await supabase
      .from('documents')
      .insert({
        id: documentId,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: file.type,
        file_size_bytes: buffer.length,
        preview_excerpt: text.slice(0, 2000),
        metadata: { full_text_length: text.length },
      });

    if (dbError) {
      console.error('DB insert error:', dbError);
      // Still return the text even if DB insert fails
    }

    return NextResponse.json({ documentId, fileName, text: text.slice(0, 50000) });
  } catch (err) {
    console.error('Upload route error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
