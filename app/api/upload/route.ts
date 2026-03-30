import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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

    // Upload file to Supabase Storage
    const buffer = Buffer.from(await file.arrayBuffer());
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

    // Read file text for processing
    const text = await file.text();

    // Insert document record
    const { error: dbError } = await supabase
      .from('documents')
      .insert({
        id: documentId,
        file_name: fileName,
        storage_path: storagePath,
        content: text.slice(0, 50000),
        status: 'processing',
      });

    if (dbError) {
      console.error('DB insert error:', dbError);
      return NextResponse.json({ error: 'DB insert failed' }, { status: 500 });
    }

    return NextResponse.json({ documentId, fileName });
  } catch (err) {
    console.error('Upload route error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
