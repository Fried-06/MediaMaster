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

FFMPEG_BIN = os.path.join(os.getcwd(), 'bin', 'ffmpeg.exe') if os.name == 'nt' else os.path.join(os.getcwd(), 'bin', 'ffmpeg')
if os.path.exists(FFMPEG_BIN):
    os.environ['IMAGEIO_FFMPEG_EXE'] = FFMPEG_BIN

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

        output_template = os.path.join(DOWNLOAD_FOLDER, '%(title).200s-%(id)s.%(ext)s')

        # Check for local ffmpeg
        ffmpeg_path = os.path.join(os.getcwd(), 'bin', 'ffmpeg.exe')
        if not os.path.exists(ffmpeg_path):
            # Fallback to system ffmpeg if local not found
            ffmpeg_path = 'ffmpeg'

        # Check for cookies file
        cookies_path = os.path.join(os.getcwd(), 'cookies.txt')
        if not os.path.exists(cookies_path):
             print(f"WARNING: cookies.txt NOT FOUND at {cookies_path}")


        ydl_opts = {
            'outtmpl': output_template,
            # 'noplaylist': True, # Removed to allow carousels/playlists

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
                if 'entries' in info and info['entries']:
                    entries = info['entries']
                    files = []
                    for entry in entries:
                        fpath = ydl.prepare_filename(entry)
                        if quality == 'audio':
                            fpath = os.path.splitext(fpath)[0] + '.mp3'
                        if os.path.exists(fpath):
                            files.append(fpath)
                    if not files:
                        raise Exception('No media files downloaded')
                    import zipfile, re
                    title = info.get('title') or 'download'
                    title = re.sub(r'[<>:"/\\|?*]', '', title)
                    zip_name = f"{title}.zip"
                    zip_path = os.path.join(DOWNLOAD_FOLDER, zip_name)
                    with zipfile.ZipFile(zip_path, 'w') as zf:
                        for f in files:
                            zf.write(f, os.path.basename(f))
                    downloads[task_id]['status'] = 'completed'
                    downloads[task_id]['result'] = {
                        'filename': zip_name,
                        'title': info.get('title', 'Unknown Title'),
                        'download_url': f'/files/{zip_name}'
                    }
                else:
                    filename = ydl.prepare_filename(info)
                    if quality == 'audio':
                        filename = os.path.splitext(filename)[0] + '.mp3'
                    if not os.path.exists(filename):
                        raise Exception('Downloaded file not found')
                    downloads[task_id]['status'] = 'completed'
                    downloads[task_id]['result'] = {
                        'filename': os.path.basename(filename),
                        'title': info.get('title', 'Unknown Title'),
                        'download_url': f"/files/{os.path.basename(filename)}"
                    }
        except yt_dlp.utils.DownloadError as e:
            ydl_opts['format'] = 'best'
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filename = ydl.prepare_filename(info)
                if quality == 'audio':
                    filename = os.path.splitext(filename)[0] + '.mp3'
                downloads[task_id]['status'] = 'completed'
                downloads[task_id]['result'] = {
                    'filename': os.path.basename(filename),
                    'title': info.get('title', 'Unknown Title'),
                    'download_url': f"/files/{os.path.basename(filename)}"
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
        from moviepy.editor import VideoFileClip
        file_id = str(uuid.uuid4())
        input_path = os.path.join(DOWNLOAD_FOLDER, f"{file_id}_{file.filename}")
        file.save(input_path)

        output_filename = f"{file_id}.mp3"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)

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
        
        ffmpeg_bin = FFMPEG_BIN if os.path.exists(FFMPEG_BIN) else 'ffmpeg'
        cmd = [
            ffmpeg_bin, '-y', '-i', input_path,
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
        return jsonify({'error': f"Compression failed: {e.stderr.decode(errors='ignore')}"}), 500
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
    x = float(request.form.get('x', 0))
    y = float(request.form.get('y', 0))
    width = float(request.form.get('width', 100))
    height = float(request.form.get('height', 50))
    
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
        
        ih, iw = img.shape[:2]
        if x <= 1.0 and y <= 1.0:
            x = int(x * iw)
            y = int(y * ih)
        if width <= 1.0 and height <= 1.0:
            width = int(width * iw)
            height = int(height * ih)
        x = int(x)
        y = int(y)
        width = int(width)
        height = int(height)
        x = max(0, min(iw - 1, x))
        y = max(0, min(ih - 1, y))
        x2 = max(0, min(iw, x + width))
        y2 = max(0, min(ih, y + height))
        mask = np.zeros(img.shape[:2], dtype=np.uint8)
        mask[y:y2, x:x2] = 255
        
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

from werkzeug.utils import secure_filename

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
        
        # Helper for filename
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        
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
            image_filename = f"{original_name}_page_{i+1}.png"
            image_path = os.path.join(output_dir, image_filename)
            image.save(image_path, "PNG")
            image_paths.append(image_path)
            
        # Create ZIP file
        zip_filename = f"{original_name}_images.zip"
        zip_path = os.path.join(DOWNLOAD_FOLDER, zip_filename)
        
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for img_path in image_paths:
                zipf.write(img_path, os.path.basename(img_path))
                
        # Cleanup
        os.remove(input_path)
        import shutil
        shutil.rmtree(output_dir)
        
        log_history('PDF to Images', zip_filename)
        
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
        # Use first file name as base
        first_name = os.path.splitext(secure_filename(files[0].filename))[0]
        
        for i, file in enumerate(files):
            temp_filename = f"{file_id}_{i}.pdf"
            temp_path = os.path.join(DOWNLOAD_FOLDER, temp_filename)
            file.save(temp_path)
            temp_paths.append(temp_path)
            merger.append(temp_path)
            
        output_filename = f"{first_name}_merged.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        merger.write(output_path)
        merger.close()
        
        # Cleanup
        for path in temp_paths:
            if os.path.exists(path):
                os.remove(path)
                
        log_history('Merge PDF', output_filename)
        
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
        
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        
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
                
        output_filename = f"{original_name}_extracted.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        with open(output_path, 'wb') as f:
            writer.write(f)
            
        # Cleanup
        os.remove(input_path)
        
        log_history('Extract Pages', output_filename)
        
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
        
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        
        # Save input
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        doc = fitz.open(input_path)
        
        output_filename = f"{original_name}_compressed.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        # Compress by saving with garbage collection and deflate
        # Using "deflate" alone might increase size. 
        # Attempt to downsample images if possible (needs scrubbing) or just standard clean.
        doc.save(output_path, garbage=4, deflate=True)
        doc.close()
        
        # Check if size actually decreased
        input_size = os.path.getsize(input_path)
        output_size = os.path.getsize(output_path)
        
        if output_size >= input_size:
            # Compression failed to reduce size - return original (renamed)
             # Or try a stronger compression if available? For now, fallback to original to avoid "bigger" file.
             # Ideally we would downsample images here.
             import shutil
             shutil.copy2(input_path, output_path)
             # Could rename to indicate no compression, but keep as is for consistency.
        
        # Cleanup
        os.remove(input_path)
        
        log_history('Compress PDF', output_filename)
        
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
        
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        
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
        
        output_filename = f"{original_name}_locked.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        with open(output_path, 'wb') as f:
            writer.write(f)
            
        # Cleanup
        os.remove(input_path)
        
        log_history('Lock PDF', output_filename)
        
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
        
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        
        # Save input
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        
        output_filename = f"{original_name}.docx"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        # Convert
        cv = Converter(input_path)
        cv.convert(output_path)
        cv.close()
        
        # Cleanup
        os.remove(input_path)
        
        log_history('PDF to Word', output_filename)
        
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
        
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        
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
            
        output_filename = f"{original_name}_watermarked.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        with open(output_path, 'wb') as f:
            writer.write(f)
            
        # Cleanup
        os.remove(input_path)
        
        log_history('Add Watermark', output_filename)
        
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
    x = float(request.form.get('x', 400))
    y = float(request.form.get('y', 50))
    width = float(request.form.get('width', 150))
    height = float(request.form.get('height', 50))
    page_num = int(request.form.get('page', 0))
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    try:
        from PyPDF2 import PdfReader, PdfWriter
        from reportlab.pdfgen import canvas
        from PIL import Image
        import io
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        file_id = str(uuid.uuid4())
        input_filename = f"{file_id}.pdf"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        file.save(input_path)
        sig_id = str(uuid.uuid4())
        sig_path = os.path.join(DOWNLOAD_FOLDER, f"{sig_id}_signature.png")
        sig_img = Image.open(signature.stream)
        sig_img.save(sig_path, 'PNG')
        reader = PdfReader(input_path)
        writer = PdfWriter()
        if not (0 <= page_num < len(reader.pages)):
            return jsonify({'error': 'Invalid page index'}), 400
        page_width = float(reader.pages[page_num].mediabox.width)
        page_height = float(reader.pages[page_num].mediabox.height)
        def norm(v, size):
            return float(v) * size if float(v) <= 1.0 else float(v)
        x = norm(x, page_width)
        y = norm(y, page_height)
        width = norm(width, page_width)
        height = norm(height, page_height)
        y_pdf = page_height - y - height
        packet = io.BytesIO()
        can = canvas.Canvas(packet, pagesize=(page_width, page_height))
        can.drawImage(sig_path, x, y_pdf, width=width, height=height, mask='auto')
        can.save()
        packet.seek(0)
        sig_pdf = PdfReader(packet)
        sig_page = sig_pdf.pages[0]
        reader.pages[page_num].merge_page(sig_page)
        for page in reader.pages:
            writer.add_page(page)
        output_filename = f"{original_name}_signed.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        with open(output_path, 'wb') as f:
            writer.write(f)
        if os.path.exists(input_path):
            os.remove(input_path)
        if os.path.exists(sig_path):
            os.remove(sig_path)
        log_history('Add Signature/Image', output_filename)
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f"/files/{output_filename}"
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
        
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        
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
            
            # Handle coordinates
            # PyMuPDF (fitz) uses Top-Left origin (0,0).
            # So if we receive normalized coords (0-1 from Top-Left), we just scale by width/height.
            if x <= 1.0 and y <= 1.0:
                 x = x * page.rect.width
                 y = y * page.rect.height
                 
            page.insert_text((x, y), text, fontsize=fontsize, color=(r, g, b))
            
        output_filename = f"{original_name}_edited.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        doc.save(output_path)
        doc.close()
        
        # Cleanup
        os.remove(input_path)
        
        log_history('Edit PDF', output_filename)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

import json
from datetime import datetime
from werkzeug.utils import secure_filename

# --- HISTORY & NEW TOOLS (Phase 2) ---

HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'history.json')

def log_history(action, filename, status='success'):
    try:
        entry = {
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'action': action,
            'filename': filename,
            'status': status
        }
        
        history = []
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, 'r') as f:
                try:
                    history = json.load(f)
                except:
                    pass
        
        history.insert(0, entry) # Prepend
        history = history[:100] # Keep last 100
        
        with open(HISTORY_FILE, 'w') as f:
            json.dump(history, f, indent=4)
            
    except Exception as e:
        print(f"Error logging history: {e}")

@app.route('/api/history', methods=['GET'])
def get_history():
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, 'r') as f:
                history = json.load(f)
                return jsonify(history)
        return jsonify([])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/img-to-pdf', methods=['POST'])
def img_to_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    try:
        import img2pdf
        from PIL import Image
        
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        file_id = str(uuid.uuid4())
        
        input_path = os.path.join(DOWNLOAD_FOLDER, f"{file_id}_{secure_filename(file.filename)}")
        file.save(input_path)
        
        output_filename = f"{original_name}_converted.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        with open(output_path, "wb") as f:
            f.write(img2pdf.convert(input_path))
            
        os.remove(input_path)
        log_history('Image to PDF', output_filename)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}',
            'storage_path': os.path.abspath(output_path)
        })
    except Exception as e:
        log_history('Image to PDF', file.filename, 'failed')
        return jsonify({'error': str(e)}), 500

@app.route('/api/word-to-pdf', methods=['POST'])
def word_to_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    if not file.filename.endswith(('.docx', '.doc')):
        return jsonify({'error': 'Invalid file type. Please upload a Word document.'}), 400
        
    try:
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        file_id = str(uuid.uuid4())
        
        input_filename = f"{file_id}_{secure_filename(file.filename)}"
        input_path = os.path.join(DOWNLOAD_FOLDER, input_filename)
        input_path_abs = os.path.abspath(input_path)
        file.save(input_path)
        
        output_filename = f"{original_name}_converted.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        output_path_abs = os.path.abspath(output_path)
        
        if os.name == 'nt':
            from docx2pdf import convert
            convert(input_path_abs, output_path_abs)
        else:
            # Linux (Render) - Use LibreOffice
            import subprocess
            # libreoffice --headless --convert-to pdf --outdir <dir> <file>
            cmd = ['libreoffice', '--headless', '--convert-to', 'pdf', '--outdir', DOWNLOAD_FOLDER, input_path]
            subprocess.run(cmd, check=True)
            # LibreOffice output filename is same as input basename .pdf
            # Check if output exists (LibreOffice might name it slightly differently)
            # The expected output is input_filename replaced extension with .pdf
            # Our input was f"{file_id}_{secure_filename(file.filename)}"
            # expected output name by LO: f"{file_id}_{secure_filename(file.filename).rsplit('.',1)[0]}.pdf"
            
            # We want to rename it to our standard output_filename
            lo_output = os.path.splitext(input_path)[0] + ".pdf"
            if os.path.exists(lo_output):
                os.rename(lo_output, output_path)
            
        if os.path.exists(input_path): os.remove(input_path)
        log_history('Word to PDF', output_filename)
        
        return jsonify({
            'success': True,
            'filename': output_filename,
            'download_url': f'/files/{output_filename}',
            'storage_path': output_path_abs
        })
    except Exception as e:
        log_history('Word to PDF', file.filename, 'failed')
        return jsonify({'error': str(e)}), 500

@app.route('/api/ppt-to-pdf', methods=['POST'])
def ppt_to_pdf():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    try:
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        file_id = str(uuid.uuid4())
        input_path = os.path.abspath(os.path.join(DOWNLOAD_FOLDER, f"{file_id}_{secure_filename(file.filename)}"))
        file.save(input_path)
        
        output_filename = f"{original_name}_converted.pdf"
        output_path = os.path.abspath(os.path.join(DOWNLOAD_FOLDER, output_filename))
        
        if os.name == 'nt':
            import comtypes.client
            powerpoint = comtypes.client.CreateObject("Powerpoint.Application")
            # powerpoint.Visible = 1
            deck = powerpoint.Presentations.Open(input_path)
            deck.SaveAs(output_path, 32)
            deck.Close()
            powerpoint.Quit()
        else:
            # Linux (Render) - Use LibreOffice
            import subprocess
            cmd = ['libreoffice', '--headless', '--convert-to', 'pdf', '--outdir', DOWNLOAD_FOLDER, input_path]
            subprocess.run(cmd, check=True)
            
            # Rename output to match our convention
            lo_output = os.path.splitext(input_path)[0] + ".pdf"
            if os.path.exists(lo_output):
                os.rename(lo_output, output_path)
            
        if os.path.exists(input_path): os.remove(input_path)
        log_history('PPT to PDF', output_filename)
        return jsonify({'success': True, 'filename': output_filename, 'download_url': f'/files/{output_filename}', 'storage_path': output_path})
    except Exception as e:
        log_history('PPT to PDF', file.filename, 'failed')
        return jsonify({'error': str(e)}), 500

@app.route('/api/unlock-pdf', methods=['POST'])
def unlock_pdf():
    file = request.files.get('file')
    password = request.form.get('password')
    if not file or not password: return jsonify({'error': 'Missing file or password'}), 400
    try:
        import pikepdf
        original_name = os.path.splitext(secure_filename(file.filename))[0]
        input_path = os.path.join(DOWNLOAD_FOLDER, f"{uuid.uuid4()}.pdf")
        file.save(input_path)
        
        output_filename = f"{original_name}_unlocked.pdf"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        
        with pikepdf.open(input_path, password=password) as pdf:
            pdf.save(output_path)
            
        os.remove(input_path)
        log_history('Unlock PDF', output_filename)
        return jsonify({'success': True, 'filename': output_filename, 'download_url': f'/files/{output_filename}', 'storage_path': os.path.abspath(output_path)})
    except Exception as e:
        log_history('Unlock PDF', file.filename, 'failed')
        return jsonify({'error': str(e)}), 500

@app.route('/api/draw-pdf', methods=['POST'])
def draw_pdf():
    # Helper to allow drawing (overlay image)
    return add_signature()

@app.errorhandler(500)
def handle_500_error(e):
    return jsonify({'error': 'Internal Server Error', 'details': str(e)}), 500

@app.errorhandler(404)
def handle_404_error(e):
    return jsonify({'error': 'Not Found'}), 404

def check_dependencies():
    print("------------------ CHECKING DEPENDENCIES ------------------")
    deps = {
        'ffmpeg': 'Critical for media conversion',
        'ffprobe': 'Critical for media analysis',
    }
    
    bin_path = os.path.join(os.getcwd(), 'bin')
    os.environ['PATH'] += os.pathsep + bin_path
    
    missing = []
    for dep, desc in deps.items():
        from shutil import which
        if not which(dep):
            missing.append(f"{dep} ({desc})")
            print(f"❌ {dep} NOT FOUND")
        else:
            print(f"✅ {dep} found")
            
    if missing:
        print("WARNING: Some dependencies are missing. Features may act up.")
        print(f"Missing: {', '.join(missing)}")
        # We don't exit, just warn
    else:
        print("All critical dependencies check out.")
    print("-----------------------------------------------------------")

if __name__ == '__main__':
    print("------------------ SERVER STARTING ------------------")
    check_dependencies()
    # For local development only
    app.run(debug=True, use_reloader=False, port=5000)
# For production (Gunicorn), the app object is used directly
