import os
import uuid
import threading
import socket
import subprocess
import io
import numpy as np
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import yt_dlp
from gtts import gTTS
from PIL import Image
# rembg and cv2 are loaded lazily to avoid startup timeout

# --- DNS WORKAROUND FOR HUGGING FACE ---
# Use Google DNS (8.8.8.8) to resolve hostnames
original_getaddrinfo = socket.getaddrinfo

def patched_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    """Custom DNS resolver that tries multiple approaches"""
    try:
        # First, try the original resolver
        return original_getaddrinfo(host, port, family, type, proto, flags)
    except socket.gaierror as e:
        print(f"DNS resolution failed for {host}, trying fallback...")
        # If it fails, try with IPv4 only
        try:
            return original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
        except:
            raise e

socket.getaddrinfo = patched_getaddrinfo
# --- END DNS WORKAROUND ---

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configuration
DOWNLOAD_FOLDER = os.path.join(os.getcwd(), 'downloads')
# Ensure download folder exists
if not os.path.exists(DOWNLOAD_FOLDER):
    os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = DOWNLOAD_FOLDER

@app.route('/')
def index():
    return send_from_directory('.', 'medimaster.html')

@app.route('/css/<path:path>')
def send_css(path):
    return send_from_directory('css', path)

@app.route('/js/<path:path>')
def send_js(path):
    return send_from_directory('js', path)

@app.route('/<path:filename>')
def serve_static_root(filename):
    # Serve images and other static files from root
    root_dir = os.path.dirname(os.path.abspath(__file__))
    return send_from_directory(root_dir, filename)

# Global dictionary to store download tasks
downloads = {}

def download_worker(task_id, url, quality):
    try:
        downloads[task_id]['status'] = 'downloading'
        downloads[task_id]['progress'] = 0

        def progress_hook(d):
            if downloads[task_id].get('cancel_event'):
                raise Exception("Download cancelled by user")
            
            if d['status'] == 'downloading':
                try:
                    p = d.get('_percent_str', '0%').replace('%', '')
                    # Remove ANSI escape codes if present
                    import re
                    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
                    p = ansi_escape.sub('', p)
                    downloads[task_id]['progress'] = float(p)
                except Exception:
                    # Fallback to calculating from bytes
                    try:
                        total = d.get('total_bytes') or d.get('total_bytes_estimate')
                        downloaded = d.get('downloaded_bytes')
                        if total and downloaded:
                            downloads[task_id]['progress'] = (downloaded / total) * 100
                    except:
                        pass
            elif d['status'] == 'finished':
                downloads[task_id]['progress'] = 100

        # Generate a unique filename
        output_template = os.path.join(DOWNLOAD_FOLDER, f'{task_id}.%(ext)s')

        # Check for local ffmpeg
        ffmpeg_path = os.path.join(os.getcwd(), 'bin', 'ffmpeg.exe')
        if not os.path.exists(ffmpeg_path):
            # Fallback to system ffmpeg if local not found
            ffmpeg_path = 'ffmpeg'

        # Check for cookies file
        cookies_path = os.path.join(os.getcwd(), 'cookies.txt')
        if os.path.exists(cookies_path):
            file_size = os.path.getsize(cookies_path)
            print(f"Found cookies.txt at {cookies_path} (Size: {file_size} bytes)")
            if file_size == 0:
                print("WARNING: cookies.txt is EMPTY!")
        else:
            print(f"WARNING: cookies.txt NOT FOUND at {cookies_path}")

        ydl_opts = {
            'outtmpl': output_template,
            'noplaylist': True,
            # 'source_address': '0.0.0.0', # Removed to allow IPv6
            'cookiefile': cookies_path,  # Use absolute path
            'extractor_args': {
                'youtube': {
                    'player_client': ['android_tv'],
                }
            },
            'verbose': True, # Enable verbose logging
            'progress_hooks': [progress_hook],
            'ffmpeg_location': os.path.dirname(ffmpeg_path) if os.path.exists(ffmpeg_path) else None,
            'merge_output_format': 'mp4',
        }

        if quality == 'audio':
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }]
        elif quality == '4k':
            ydl_opts['format'] = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]'
        elif quality == '2k':
            ydl_opts['format'] = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]'
        elif quality == 'hd':
            # Try best quality (usually 1080p if available, or higher), fallback to single file best
            ydl_opts['format'] = 'bestvideo+bestaudio/best'
        elif quality == '480p':
            ydl_opts['format'] = 'bestvideo[height<=480]+bestaudio/best[height<=480]'
        elif quality == '360p':
            ydl_opts['format'] = 'bestvideo[height<=360]+bestaudio/best[height<=360]'
        elif quality == '240p':
            ydl_opts['format'] = 'bestvideo[height<=240]+bestaudio/best[height<=240]'
        elif quality == '144p':
            ydl_opts['format'] = 'bestvideo[height<=144]+bestaudio/best[height<=144]'
        else:
             # Default fallback
            ydl_opts['format'] = 'best'

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
        except yt_dlp.utils.DownloadError as e:
            # If format not available or other error, try fallback to 'best'
            print(f"Download failed with initial options: {e}. Retrying with format='best'...")
            ydl_opts['format'] = 'best'
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

        filename = ydl.prepare_filename(info)
        
        if quality == 'audio':
            filename = os.path.splitext(filename)[0] + '.mp3'
        
        # Rename to title
        import re
        def sanitize_filename(name):
            return re.sub(r'[<>:"/\\|?*]', '', name)

        safe_title = sanitize_filename(info.get('title', 'video'))
        ext = os.path.splitext(filename)[1]
        new_filename = f"{safe_title}{ext}"
        new_path = os.path.join(DOWNLOAD_FOLDER, new_filename)
        
        # Handle duplicates
        counter = 1
        while os.path.exists(new_path):
            new_filename = f"{safe_title} ({counter}){ext}"
            new_path = os.path.join(DOWNLOAD_FOLDER, new_filename)
            counter += 1
        
        os.rename(filename, new_path)
        
        downloads[task_id]['status'] = 'completed'
        downloads[task_id]['result'] = {
            'filename': new_filename,
            'title': info.get('title', 'Unknown Title'),
            'download_url': f'/files/{new_filename}'
        }

    except Exception as e:
        if str(e) == "Download cancelled by user":
            downloads[task_id]['status'] = 'cancelled'
        else:
            downloads[task_id]['status'] = 'error'
            downloads[task_id]['error'] = str(e)

@app.route('/api/download', methods=['POST'])
def start_download():
    data = request.json
    url = data.get('url')
    quality = data.get('quality', 'hd')
    
    if not url:
        return jsonify({'error': 'URL is required'}), 400

    task_id = str(uuid.uuid4())
    downloads[task_id] = {
        'status': 'pending',
        'progress': 0,
        'cancel_event': False
    }

    thread = threading.Thread(target=download_worker, args=(task_id, url, quality))
    thread.start()

    return jsonify({'task_id': task_id})

@app.route('/api/download/status/<task_id>', methods=['GET'])
def get_download_status(task_id):
    task = downloads.get(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(task)

@app.route('/api/download/cancel/<task_id>', methods=['POST'])
def cancel_download(task_id):
    task = downloads.get(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    
    if task['status'] in ['pending', 'downloading']:
        task['cancel_event'] = True
        return jsonify({'message': 'Cancellation requested'})
    
    return jsonify({'message': 'Task already completed or failed'}), 400

@app.route('/api/convert-image', methods=['POST'])
def convert_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    target_format = request.form.get('format', 'png').lower()
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    try:
        from PIL import Image
        import io

        # Open image
        img = Image.open(file.stream)
        
        # Convert mode if necessary (e.g. RGBA to RGB for JPEG)
        if target_format in ['jpeg', 'jpg', 'bmp'] and img.mode in ['RGBA', 'P']:
            img = img.convert('RGB')
        
        # Save to buffer
        output_buffer = io.BytesIO()
        save_format = target_format
        if target_format == 'jpg': save_format = 'jpeg'
        
        img.save(output_buffer, format=save_format.upper())
        output_buffer.seek(0)
        
        # Generate filename
        original_name = os.path.splitext(file.filename)[0]
        new_filename = f"{original_name}.{target_format}"
        
        return send_file(
            output_buffer,
            mimetype=f'image/{target_format}',
            as_attachment=True,
            download_name=new_filename
        )

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/convert-video', methods=['POST'])
def convert_video():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    try:
        file_id = str(uuid.uuid4())
        input_path = os.path.join(DOWNLOAD_FOLDER, f"{file_id}_{file.filename}")
        file.save(input_path)

        output_filename = f"{file_id}.mp3"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)

        # Convert using MoviePy
        video = VideoFileClip(input_path)
        video.audio.write_audiofile(output_path)
        video.close()
        
        # Clean up input video if needed (optional, keeping for now)
        # os.remove(input_path)

        return jsonify({
            'success': True,
            'message': 'Conversion complete',
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/convert-text', methods=['POST'])
def convert_text():
    data = request.json
    text = data.get('text')
    voice = data.get('voice', 'en') # Simple mapping for now
    
    if not text:
        return jsonify({'error': 'Text is required'}), 400

    try:
        # Map UI voices to gTTS languages/tlds
        lang = 'fr'
        tld = 'fr'
        
        if voice == 'thomas':
            lang = 'fr' # gTTS doesn't support specific voices easily, just languages. 
            # We will stick to standard French for now.
        elif voice == 'robot':
            lang = 'en' # Just to sound different
        
        tts = gTTS(text=text, lang=lang, tld=tld)
        
        file_id = str(uuid.uuid4())
        filename = f"{file_id}.mp3"
        output_path = os.path.join(DOWNLOAD_FOLDER, filename)
        
        tts.save(output_path)

        return jsonify({
            'success': True,
            'message': 'Text converted to audio',
            'filename': filename,
            'download_url': f'/files/{filename}'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/files/<path:filename>')
def serve_file(filename):
    return send_from_directory(DOWNLOAD_FOLDER, filename, as_attachment=True)

# --- VIDEO COMPRESSION ---
@app.route('/api/compress-video', methods=['POST'])
def compress_video():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    quality = request.form.get('quality', 'medium')  # low, medium, high
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    try:
        # Save uploaded file
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}_input.mp4"
        output_filename = f"{file_id}_compressed.mp4"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        file.save(input_path)
        
        # Set compression parameters based on quality
        if quality == 'low':
            crf = 35  # Higher CRF = more compression, lower quality
            scale = "640:-2"
        elif quality == 'high':
            crf = 23  # Lower CRF = less compression, higher quality
            scale = "1920:-2"
        else:  # medium
            crf = 28
            scale = "1280:-2"
        
        # Run ffmpeg compression
        cmd = [
            'ffmpeg', '-y', '-i', input_path,
            '-vf', f'scale={scale}',
            '-c:v', 'libx264', '-crf', str(crf),
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            output_path
        ]
        
        subprocess.run(cmd, check=True, capture_output=True)
        
        # Clean up input file
        os.remove(input_path)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except subprocess.CalledProcessError as e:
        return jsonify({'error': f'Compression failed: {e.stderr.decode()}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# --- BACKGROUND REMOVAL ---
@app.route('/api/remove-background', methods=['POST'])
def remove_background():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    try:
        # Lazy load rembg to avoid startup timeout
        from rembg import remove
        
        # Read image
        input_image = Image.open(file.stream)
        
        # Remove background
        output_image = remove(input_image)
        
        # Save to bytes
        file_id = str(uuid.uuid4())
        output_filename = f"{file_id}_nobg.png"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        output_image.save(output_path, 'PNG')
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# --- WATERMARK REMOVAL ---
@app.route('/api/remove-watermark', methods=['POST'])
def remove_watermark():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    # Get mask coordinates from form data (x, y, width, height)
    x = int(request.form.get('x', 0))
    y = int(request.form.get('y', 0))
    width = int(request.form.get('width', 100))
    height = int(request.form.get('height', 50))
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    try:
        # Lazy load cv2 to avoid startup timeout
        import cv2
        
        # Read image with OpenCV
        file_bytes = np.frombuffer(file.read(), np.uint8)
        img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
        
        if img is None:
            return jsonify({'error': 'Could not read image'}), 400
        
        # Create mask for inpainting
        mask = np.zeros(img.shape[:2], dtype=np.uint8)
        mask[y:y+height, x:x+width] = 255
        
        # Inpaint to remove watermark
        result = cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA)
        
        # Save result
        file_id = str(uuid.uuid4())
        output_filename = f"{file_id}_nowm.png"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        cv2.imwrite(output_path, result)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# --- PDF TOOLS ---

# 1. PDF to Images
@app.route('/api/pdf-to-images', methods=['POST'])
def pdf_to_images():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    try:
        from pdf2image import convert_from_path
        import zipfile
        
        # Save input PDF
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        # Create output directory for images
        output_dir = os.path.join(DOWNLOAD_FOLDER, file_id)
        os.makedirs(output_dir, exist_ok=True)
        
        # Convert output
        images = convert_from_path(input_path)
        
        image_paths = []
        for i, image in enumerate(images):
            image_filename = f"page_{i+1}.png"
            image_path = os.path.join(output_dir, image_filename)
            image.save(image_path, "PNG")
            image_paths.append(image_path)
            
        # Create ZIP file
        zip_filename = f"{file_id}_images.zip"
        zip_path = os.path.join(DOWNLOAD_FOLDER, zip_filename)
        
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for img_path in image_paths:
                zipf.write(img_path, os.path.basename(img_path))
                
        # Cleanup
        os.remove(input_path)
        import shutil
        shutil.rmtree(output_dir)
        
        return jsonify({
            'success': True,
            'filename': zip_filename,
            'download_url': f'/files/{zip_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 2. Merge PDF
@app.route('/api/merge-pdf', methods=['POST'])
def merge_pdf():
    if 'files[]' not in request.files:
        return jsonify({'error': 'No files provided'}), 400
    
    files = request.files.getlist('files[]')
    if not files or files[0].filename == '':
        return jsonify({'error': 'No files selected'}), 400
        
    try:
        from PyPDF2 import PdfMerger
        
        merger = PdfMerger()
        temp_paths = []
        
        file_id = str(uuid.uuid4())
        
        for i, file in enumerate(files):
            temp_filename = f"{file_id}_{i}.pdf"
            temp_path = os.path.join(DOWNLOAD_FOLDER, temp_filename)
            file.save(temp_path)
            temp_paths.append(temp_path)
            merger.append(temp_path)
            
        output_filename = f"{file_id}_merged.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        merger.write(output_path)
        merger.close()
        
        # Cleanup
        for path in temp_paths:
            if os.path.exists(path):
                os.remove(path)
                
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 3. Extract Pages
@app.route('/api/extract-pages', methods=['POST'])
def extract_pages():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    pages_arg = request.form.get('pages', '') # "1,3,5-7"
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    if not pages_arg:
        return jsonify({'error': 'No pages specified'}), 400
        
    try:
        from PyPDF2 import PdfReader, PdfWriter
        
        # Save input
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        reader = PdfReader(input_path)
        writer = PdfWriter()
        
        # Parse pages argument (e.g. "1,3,5-7")
        page_indices = set()
        parts = pages_arg.split(',')
        for part in parts:
            part = part.strip()
            if '-' in part:
                start, end = map(int, part.split('-'))
                # 1-based to 0-based
                for i in range(start-1, end):
                    page_indices.add(i)
            else:
                page_indices.add(int(part) - 1)
                
        for i in sorted(page_indices):
            if 0 <= i < len(reader.pages):
                writer.add_page(reader.pages[i])
                
        output_filename = f"{file_id}_extracted.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        with open(output_path, 'wb') as f:
            writer.write(f)
            
        # Cleanup
        os.remove(input_path)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 4. Compress PDF
@app.route('/api/compress-pdf', methods=['POST'])
def compress_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    try:
        import fitz  # pymupdf
        
        # Save input
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        doc = fitz.open(input_path)
        
        output_filename = f"{file_id}_compressed.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        # Compress by saving with garbage collection and deflate
        doc.save(output_path, garbage=4, deflate=True)
        doc.close()
        
        # Cleanup
        os.remove(input_path)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 5. Lock PDF
@app.route('/api/lock-pdf', methods=['POST'])
def lock_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    password = request.form.get('password')
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    if not password:
        return jsonify({'error': 'No password provided'}), 400
        
    try:
        from PyPDF2 import PdfReader, PdfWriter
        
        # Save input
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        reader = PdfReader(input_path)
        writer = PdfWriter()
        
        # Add all pages
        for page in reader.pages:
            writer.add_page(page)
            
        # Encrypt
        writer.encrypt(password)
        
        output_filename = f"{file_id}_locked.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        with open(output_path, 'wb') as f:
            writer.write(f)
            
        # Cleanup
        os.remove(input_path)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 6. PDF to Word
@app.route('/api/pdf-to-word', methods=['POST'])
def pdf_to_word():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    try:
        from pdf2docx import Converter
        
        # Save input
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        output_filename = f"{file_id}.docx"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        # Convert
        cv = Converter(input_path)
        cv.convert(output_path)
        cv.close()
        
        # Cleanup
        os.remove(input_path)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 7. Add Watermark
@app.route('/api/add-watermark', methods=['POST'])
def add_watermark():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    text = request.form.get('text', 'Watermark')
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    try:
        from PyPDF2 import PdfReader, PdfWriter
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import letter
        import io
        
        # Save input
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        # Create watermark PDF
        packet = io.BytesIO()
        can = canvas.Canvas(packet, pagesize=letter)
        can.setFont("Helvetica", 40)
        can.setFillColorRGB(0.5, 0.5, 0.5, 0.5) # Grey, semi-transparent
        
        # Draw text diagonally
        can.saveState()
        can.translate(300, 400)
        can.rotate(45)
        can.drawCentredString(0, 0, text)
        can.restoreState()
        
        can.save()
        packet.seek(0)
        
        watermark_pdf = PdfReader(packet)
        watermark_page = watermark_pdf.pages[0]
        
        reader = PdfReader(input_path)
        writer = PdfWriter()
        
        # Overlay watermark on each page
        for page in reader.pages:
            page.merge_page(watermark_page)
            writer.add_page(page)
            
        output_filename = f"{file_id}_watermarked.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        with open(output_path, 'wb') as f:
            writer.write(f)
            
        # Cleanup
        os.remove(input_path)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 8. Add Signature
@app.route('/api/add-signature', methods=['POST'])
def add_signature():
    if 'file' not in request.files or 'signature' not in request.files:
        return jsonify({'error': 'File or signature missing'}), 400
        
    file = request.files['file']
    signature = request.files['signature']
    
    # Coords (normalized 0-1 or pixels?) Let's use pixels for now, defaulted to bottom right
    x = int(request.form.get('x', 400))
    y = int(request.form.get('y', 50))
    width = int(request.form.get('width', 150))
    height = int(request.form.get('height', 50))
    page_num = int(request.form.get('page', 0)) # 0-indexed
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    try:
        from PyPDF2 import PdfReader, PdfWriter
        from reportlab.pdfgen import canvas
        from PIL import Image
        import io
        
        # Save input
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        # Create signature PDF
        packet = io.BytesIO()
        can = canvas.Canvas(packet)
        
        # Save signature image temporarily
        sig_filename = f"{file_id}_sig.png"
        sig_path = os.path.join(DOWNLOAD_FOLDER, sig_filename)
        signature.save(sig_path)
        
        # Draw image
        can.drawImage(sig_path, x, y, width=width, height=height, mask='auto')
        can.save()
        packet.seek(0)
        
        sig_pdf = PdfReader(packet)
        sig_page = sig_pdf.pages[0]
        
        reader = PdfReader(input_path)
        writer = PdfWriter()
        
        # Overlay signature on specific page
        for i, page in enumerate(reader.pages):
            if i == page_num:
                page.merge_page(sig_page)
            writer.add_page(page)
            
        output_filename = f"{file_id}_signed.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        with open(output_path, 'wb') as f:
            writer.write(f)
            
        # Cleanup
        os.remove(input_path)
        if os.path.exists(sig_path):
            os.remove(sig_path)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 9. Edit PDF (Add Text Annotation)
@app.route('/api/edit-pdf', methods=['POST'])
def edit_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    text = request.form.get('text', '')
    x = float(request.form.get('x', 100))
    y = float(request.form.get('y', 100))
    page_num = int(request.form.get('page', 0))
    fontsize = int(request.form.get('fontsize', 11))
    color = request.form.get('color', '0,0,0') # "r,g,b"
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    if not text:
        return jsonify({'error': 'No text provided'}), 400
        
    try:
        import fitz # pymupdf
        
        # Save input
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        doc = fitz.open(input_path)
        if 0 <= page_num < len(doc):
            page = doc[page_num]
            
            # Parse color
            r, g, b = map(float, color.split(','))
            # Normalize to 0-1 if > 1
            if r > 1 or g > 1 or b > 1:
                r, g, b = r/255, g/255, b/255
                
            page.insert_text((x, y), text, fontsize=fontsize, color=(r, g, b))
            
        output_filename = f"{file_id}_edited.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        doc.save(output_path)
        doc.close()
        
        # Cleanup
        os.remove(input_path)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("------------------ SERVER STARTING ------------------")
    # For local development only
    app.run(debug=True, use_reloader=False, port=5000)
# For production (Gunicorn), the app object is used directly
