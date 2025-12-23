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
import re
import zipfile
# rembg and cv2 are loaded lazily to avoid startup timeout
# Preload rembg session for faster background removal
REMBG_SESSION = None
def get_rembg_session():
    global REMBG_SESSION
    if REMBG_SESSION is None:
        try:
            from rembg import new_session
            REMBG_SESSION = new_session("u2net")
            print("Rembg model preloaded successfully")
        except Exception as e:
            print(f"Failed to preload rembg: {e}")
    return REMBG_SESSION

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

# Reviews storage file
REVIEWS_FILE = os.path.join(os.getcwd(), 'reviews.json')

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
            'cookiefile': cookies_path if os.path.exists(cookies_path) else None,
            'extractor_args': {
                'youtube': {
                    'player_client': ['android_tv', 'web'],
                },
                'instagram': {
                    'get_video_id': True,
                }
            },
            'verbose': True,
            'progress_hooks': [progress_hook],
            'ffmpeg_location': os.path.dirname(ffmpeg_path) if os.path.exists(ffmpeg_path) else None,
            'merge_output_format': 'mp4',
            'ignoreerrors': True, # Keep going even if one item in carousel fails
            'no_warnings': True,
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
                
                # Check for cancellation again
                if downloads[task_id].get('cancel_event'):
                    raise Exception("Download cancelled by user")

                if 'entries' in info:
                    # Carousel or Playlist
                    entries = [e for e in info['entries'] if e is not None]
                    if not entries:
                        raise Exception('No media found in this link or access denied')
                    
                    downloaded_files = []
                    for entry in entries:
                        # Find the actual file on disk
                        base_fname = ydl.prepare_filename(entry)
                        # It might have been merged to mp4 or converted to mp3
                        possible_exts = ['.mp4', '.mkv', '.webm', '.mp3', '.m4a']
                        found = False
                        if os.path.exists(base_fname):
                           downloaded_files.append(base_fname)
                           found = True
                        else:
                           root = os.path.splitext(base_fname)[0]
                           for ext in possible_exts:
                               if os.path.exists(root + ext):
                                   downloaded_files.append(root + ext)
                                   found = True
                                   break
                    
                    if not downloaded_files:
                        raise Exception('Could not find downloaded files')
                    
                    # Zip them up
                    safe_title = re.sub(r'[<>:"/\\|?*]', '', info.get('title') or 'media_master_bundle')
                    zip_filename = f"{task_id}_{safe_title[:50]}.zip"
                    zip_path = os.path.join(DOWNLOAD_FOLDER, zip_filename)
                    
                    with zipfile.ZipFile(zip_path, 'w') as zf:
                        for f in downloaded_files:
                            zf.write(f, os.path.basename(f))
                    
                    downloads[task_id]['status'] = 'completed'
                    downloads[task_id]['result'] = {
                        'filename': zip_filename,
                        'title': info.get('title', 'Carousel Contents'),
                        'download_url': f'/files/{zip_filename}'
                    }
                else:
                    # Single file
                    filename = ydl.prepare_filename(info)
                    # Check for merged extensions
                    if not os.path.exists(filename):
                        root = os.path.splitext(filename)[0]
                        for ext in ['.mp4', '.mkv', '.webm', '.mp3']:
                            if os.path.exists(root + ext):
                                filename = root + ext
                                break
                    
                    if not os.path.exists(filename):
                        raise Exception('Downloaded file not found on server')

                    downloads[task_id]['status'] = 'completed'
                    downloads[task_id]['result'] = {
                        'filename': os.path.basename(filename),
                        'title': info.get('title', 'Media'),
                        'download_url': f"/files/{os.path.basename(filename)}"
                    }

        except Exception as e:
             # Fallback to extremely basic download if complex format fails
             print(f"Retrying basic download for {url} due to: {e}")
             if downloads[task_id].get('cancel_event'): raise e
             
             ydl_opts['format'] = 'best'
             with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                 info = ydl.extract_info(url, download=True)
                 filename = ydl.prepare_filename(info)
                 if not os.path.exists(filename):
                     # Try to find it if it changed ext
                     root = os.path.splitext(filename)[0]
                     for ext in ['.mp4', '.webm', '.mkv']:
                         if os.path.exists(root + ext):
                             filename = root + ext
                             break
                 
                 if os.path.exists(filename):
                     downloads[task_id]['status'] = 'completed'
                     downloads[task_id]['result'] = {
                         'filename': os.path.basename(filename),
                         'title': info.get('title', 'Media'),
                         'download_url': f"/files/{os.path.basename(filename)}"
                     }
                 else:
                     raise Exception("Final fallback failed. Media might be private or unsupported.")

    except Exception as e:
        print(f"Download Worker Error: {e}")
        if str(e) == "Download cancelled by user" or downloads[task_id].get('cancel_event'):
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

def tool_worker_wrapper(task_id, func, *args, **kwargs):
    """Generic wrapper for background tool tasks"""
    try:
        downloads[task_id]['status'] = 'processing'
        downloads[task_id]['progress'] = 10  # Initial jump
        
        result_filename = func(task_id, *args, **kwargs)
        
        # Check for cancellation
        if downloads[task_id].get('cancel_event'):
            # Clean up result if produced
            if result_filename and os.path.exists(os.path.join(DOWNLOAD_FOLDER, result_filename)):
                os.remove(os.path.join(DOWNLOAD_FOLDER, result_filename))
            downloads[task_id]['status'] = 'cancelled'
            return

        downloads[task_id]['status'] = 'completed'
        downloads[task_id]['result'] = {
            'filename': result_filename,
            'download_url': f'/files/{result_filename}'
        }
    except Exception as e:
        print(f"Tool Error ({task_id}): {e}")
        downloads[task_id]['status'] = 'error'
        downloads[task_id]['error'] = str(e)

def video_to_audio_task(task_id, input_path, output_filename):
    """Fast video to audio conversion using FFmpeg directly with cancellation support"""
    import subprocess
    import re
    
    # Check cancellation before starting
    if downloads[task_id].get('cancel_event'):
        if os.path.exists(input_path): os.remove(input_path)
        return None
    
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    ffmpeg_bin = FFMPEG_BIN if os.path.exists(FFMPEG_BIN) else 'ffmpeg'
    
    # Get video duration first for progress calculation
    duration_cmd = [ffmpeg_bin, '-i', input_path]
    try:
        result = subprocess.run(duration_cmd, capture_output=True, text=True, stderr=subprocess.STDOUT)
        duration_match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', result.stdout)
        if duration_match:
            hours, minutes, seconds = duration_match.groups()
            total_duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        else:
            total_duration = 0
    except:
        total_duration = 0
    
    downloads[task_id]['progress'] = 15
    
    # Fast audio extraction with FFmpeg (optimized settings)
    cmd = [
        ffmpeg_bin, '-i', input_path,
        '-vn',  # No video
        '-acodec', 'libmp3lame',  # MP3 codec
        '-q:a', '4',  # Good quality, faster (was 2)
        '-y',  # Overwrite
        output_path
    ]
    
    # Run with progress tracking
    process = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True, universal_newlines=True)
    downloads[task_id]['process'] = process  # Store for cancellation
    
    # Parse progress from FFmpeg output
    for line in process.stderr:
        # Check for cancellation during processing
        if downloads[task_id].get('cancel_event'):
            process.terminate()
            process.wait()
            if os.path.exists(input_path): os.remove(input_path)
            if os.path.exists(output_path): os.remove(output_path)
            return None
        
        if total_duration > 0:
            time_match = re.search(r'time=(\d+):(\d+):(\d+\.\d+)', line)
            if time_match:
                h, m, s = time_match.groups()
                current_time = int(h) * 3600 + int(m) * 60 + float(s)
                progress = min(95, 15 + int((current_time / total_duration) * 80))
                downloads[task_id]['progress'] = progress
    
    process.wait()
    
    if process.returncode != 0:
        raise Exception("Erreur lors de l'extraction audio")
    
    if os.path.exists(input_path): 
        os.remove(input_path)
    
    return output_filename

@app.route('/api/convert-video', methods=['POST'])
def convert_video():
    if 'file' not in request.files: return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({'error': 'No file selected'}), 400

    task_id = str(uuid.uuid4())
    original_name = os.path.splitext(secure_filename(file.filename))[0]
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_in_{secure_filename(file.filename)}")
    file.save(input_path)
    output_filename = f"{original_name}.mp3"
    
    # If file exists, append task_id to avoid conflict
    if os.path.exists(os.path.join(DOWNLOAD_FOLDER, output_filename)):
        output_filename = f"{original_name}_{task_id[:8]}.mp3"
    
    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, video_to_audio_task, input_path, output_filename)).start()
    
    return jsonify({'success': True, 'task_id': task_id})

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
def compress_video_task(task_id, input_path, output_filename, quality):
    """Fast video compression with real-time progress"""
    import subprocess
    import re
    
    # Set compression parameters based on quality
    if quality == 'low':
        # ultrafast: extremely fast, larger file size
        crf, scale, preset = 30, "640:-2", "ultrafast"
    elif quality == 'high':
        # superfast: very fast, better quality
        crf, scale, preset = 23, "1920:-2", "superfast"
    else: # medium
        # ultrafast: balance default
        crf, scale, preset = 26, "1280:-2", "ultrafast"
    
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    ffmpeg_bin = FFMPEG_BIN if os.path.exists(FFMPEG_BIN) else 'ffmpeg'
    
    # Get video duration for progress
    duration_cmd = [ffmpeg_bin, '-i', input_path]
    try:
        result = subprocess.run(duration_cmd, capture_output=True, text=True, stderr=subprocess.STDOUT)
        duration_match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', result.stdout)
        if duration_match:
            hours, minutes, seconds = duration_match.groups()
            total_duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        else:
            total_duration = 0
    except:
        total_duration = 0
    
    downloads[task_id]['progress'] = 20
    
    cmd = [
        ffmpeg_bin, '-y', '-i', input_path,
        '-vf', f'scale={scale}',
        '-c:v', 'libx264',
        '-preset', preset,  # Faster encoding
        '-crf', str(crf),
        '-c:a', 'aac',
        '-b:a', '96k',  # Reduced from 128k for speed
        '-movflags', '+faststart',
        output_path
    ]
    
    # Run with progress tracking
    process = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True, universal_newlines=True)
    downloads[task_id]['process'] = process  # Store for cancellation
    
    for line in process.stderr:
        # Check for cancellation during processing
        if downloads[task_id].get('cancel_event'):
            process.terminate()
            process.wait()
            if os.path.exists(input_path): os.remove(input_path)
            if os.path.exists(output_path): os.remove(output_path)
            return None
        
        # Try standard time=HH:MM:SS.ms format
        time_match = re.search(r'time=(\d+):(\d+):(\d+\.\d+)', line)
        if time_match and total_duration > 0:
            h, m, s = time_match.groups()
            current_time = int(h) * 3600 + int(m) * 60 + float(s)
            progress = min(95, 20 + int((current_time / total_duration) * 75))
            downloads[task_id]['progress'] = progress
        # Fallback for simpler format (seconds only)
        elif 'time=' in line and total_duration > 0:
            try:
                sec_match = re.search(r'time=(\d+\.\d+)', line)
                if sec_match:
                    current_time = float(sec_match.group(1))
                    progress = min(95, 20 + int((current_time / total_duration) * 75))
                    downloads[task_id]['progress'] = progress
            except:
                pass
    
    process.wait()
    
    if process.returncode != 0:
        raise Exception("Erreur lors de la compression")
    
    if os.path.exists(input_path): 
        os.remove(input_path)
    
    return output_filename

@app.route('/api/compress-video', methods=['POST'])
def compress_video():
    # DISABLED - Fonctionnalité à venir
    return jsonify({
        'error': 'Fonctionnalité temporairement désactivée - Bientôt disponible !',
        'disabled': True
    }), 503


# --- BACKGROUND REMOVAL ---
def remove_bg_task(task_id, input_path, output_filename):
    from rembg import remove
    
    # Check cancellation before starting heavy work
    if downloads[task_id].get('cancel_event'):
        if os.path.exists(input_path): os.remove(input_path)
        return None
    
    input_image = Image.open(input_path)
    downloads[task_id]['progress'] = 20
    
    # Use preloaded session for 5-10x faster processing
    session = get_rembg_session()
    downloads[task_id]['progress'] = 40
    
    if session:
        output_image = remove(input_image, session=session)
    else:
        output_image = remove(input_image)  # Fallback
    
    # Check cancellation after processing
    if downloads[task_id].get('cancel_event'):
        if os.path.exists(input_path): os.remove(input_path)
        return None
    
    downloads[task_id]['progress'] = 90
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    output_image.save(output_path, 'PNG')
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/remove-background', methods=['POST'])
def remove_background():
    # DISABLED - Fonctionnalité à venir
    return jsonify({
        'error': 'Fonctionnalité temporairement désactivée - Bientôt disponible !',
        'disabled': True
    }), 503


# --- WATERMARK REMOVAL ---
def remove_watermark_task(task_id, input_path, output_filename, x, y, width, height):
    import cv2
    img = cv2.imread(input_path)
    if img is None: raise Exception('Could not read image')
    
    ih, iw = img.shape[:2]
    # Normalize if needed
    if x <= 1.0 and y <= 1.0:
        x, y = int(x * iw), int(y * ih)
    if width <= 1.0 and height <= 1.0:
        width, height = int(width * iw), int(height * ih)
    
    x, y, w, h = int(x), int(y), int(width), int(height)
    x = max(0, min(iw - 1, x))
    y = max(0, min(ih - 1, y))
    x2 = max(0, min(iw, x + w))
    y2 = max(0, min(ih, y + h))
    
    mask = np.zeros(img.shape[:2], dtype=np.uint8)
    mask[y:y2, x:x2] = 255
    
    downloads[task_id]['progress'] = 50
    result = cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA)
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    cv2.imwrite(output_path, result)
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/remove-watermark', methods=['POST'])
def remove_watermark():
    # DISABLED - Fonctionnalité à venir
    return jsonify({
        'error': 'Fonctionnalité temporairement désactivée - Bientôt disponible !',
        'disabled': True
    }), 503


# --- PDF TOOLS ---

from werkzeug.utils import secure_filename

# 1. PDF to Images
def pdf_to_images_task(task_id, input_path, zip_filename):
    from pdf2image import convert_from_path
    import zipfile
    import shutil
    
    file_id = os.path.basename(input_path).split('_')[0]
    output_dir = os.path.join(DOWNLOAD_FOLDER, f"img_{task_id}")
    os.makedirs(output_dir, exist_ok=True)
    
    downloads[task_id]['progress'] = 20
    images = convert_from_path(input_path)
    
    image_paths = []
    total = len(images)
    for i, image in enumerate(images):
        iname = f"page_{i+1}.png"
        ipath = os.path.join(output_dir, iname)
        image.save(ipath, "PNG")
        image_paths.append(ipath)
        downloads[task_id]['progress'] = 20 + (i / total) * 60
        
    zip_path = os.path.join(DOWNLOAD_FOLDER, zip_filename)
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        for img_path in image_paths:
            zipf.write(img_path, os.path.basename(img_path))
            
    if os.path.exists(input_path): os.remove(input_path)
    shutil.rmtree(output_dir)
    return zip_filename

@app.route('/api/pdf-to-images', methods=['POST'])
def pdf_to_images():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({'error': 'No file selected'}), 400
    
    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_in.pdf")
    file.save(input_path)
    zip_filename = f"{task_id}_images.zip"

    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, pdf_to_images_task, input_path, zip_filename)).start()
    
    return jsonify({'success': True, 'task_id': task_id})

# 2. Merge PDF
def merge_pdf_task(task_id, temp_paths, output_filename):
    from PyPDF2 import PdfMerger
    merger = PdfMerger()
    total = len(temp_paths)
    for i, path in enumerate(temp_paths):
        merger.append(path)
        downloads[task_id]['progress'] = (i / total) * 80
    
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    merger.write(output_path)
    merger.close()
    
    for path in temp_paths:
        if os.path.exists(path): os.remove(path)
    return output_filename

@app.route('/api/merge-pdf', methods=['POST'])
def merge_pdf():
    files = request.files.getlist('files[]')
    if not files or files[0].filename == '': return jsonify({'error': 'No files provided'}), 400
    
    task_id = str(uuid.uuid4())
    temp_paths = []
    for i, file in enumerate(files):
        tpath = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_{i}.pdf")
        file.save(tpath)
        temp_paths.append(tpath)
        
    output_filename = f"{task_id}_merged.pdf"
    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, merge_pdf_task, temp_paths, output_filename)).start()
    
    return jsonify({'success': True, 'task_id': task_id})

# 3. Extract Pages
def extract_pages_task(task_id, input_path, output_filename, pages_arg):
    from PyPDF2 import PdfReader, PdfWriter
    reader = PdfReader(input_path)
    writer = PdfWriter()
    page_indices = set()
    parts = pages_arg.split(',')
    for part in parts:
        part = part.strip()
        if '-' in part:
            s, e = map(int, part.split('-'))
            for i in range(s-1, e): page_indices.add(i)
        else:
            page_indices.add(int(part) - 1)
    for i in sorted(page_indices):
        if 0 <= i < len(reader.pages):
            writer.add_page(reader.pages[i])
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    with open(output_path, 'wb') as f:
        writer.write(f)
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/extract-pages', methods=['POST'])
def extract_pages():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    pages_arg = request.form.get('pages', '')
    if file.filename == '': return jsonify({'error': 'No file selected'}), 400
    
    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_in.pdf")
    file.save(input_path)
    output_filename = f"{task_id}_extracted.pdf"

    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, extract_pages_task, input_path, output_filename, pages_arg)).start()
    return jsonify({'success': True, 'task_id': task_id})

# 4. Compress PDF
def compress_pdf_task(task_id, input_path, output_filename):
    import fitz
    doc = fitz.open(input_path)
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/compress-pdf', methods=['POST'])
def compress_pdf():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({'error': 'No file selected'}), 400
    
    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_in.pdf")
    file.save(input_path)
    output_filename = f"{task_id}_compressed.pdf"
    
    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, compress_pdf_task, input_path, output_filename)).start()
    return jsonify({'success': True, 'task_id': task_id})

# 5. Lock PDF
def lock_pdf_task(task_id, input_path, output_filename, password):
    from PyPDF2 import PdfReader, PdfWriter
    reader = PdfReader(input_path)
    writer = PdfWriter()
    for page in reader.pages: writer.add_page(page)
    writer.encrypt(password)
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    with open(output_path, 'wb') as f: writer.write(f)
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/lock-pdf', methods=['POST'])
def lock_pdf():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    password = request.form.get('password')
    if file.filename == '': return jsonify({'error': 'No file selected'}), 400
    if not password: return jsonify({'error': 'No password provided'}), 400
    
    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_in.pdf")
    file.save(input_path)
    output_filename = f"{task_id}_locked.pdf"
    
    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, lock_pdf_task, input_path, output_filename, password)).start()
    return jsonify({'success': True, 'task_id': task_id})

# 6. PDF to Word
def pdf_to_word_task(task_id, input_path, output_filename):
    from pdf2docx import Converter
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    cv = Converter(input_path)
    downloads[task_id]['progress'] = 20
    cv.convert(output_path)
    cv.close()
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/pdf-to-word', methods=['POST'])
def pdf_to_word():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({'error': 'No file selected'}), 400
    
    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_in.pdf")
    file.save(input_path)
    original_name = os.path.splitext(secure_filename(file.filename))[0]
    output_filename = f"{task_id}_{original_name}.docx"

    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, pdf_to_word_task, input_path, output_filename)).start()
    
    return jsonify({'success': True, 'task_id': task_id})

# 7. Add Watermark
def add_watermark_task(task_id, input_path, output_filename, text):
    from PyPDF2 import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    import io

    packet = io.BytesIO()
    can = canvas.Canvas(packet, pagesize=letter)
    can.setFont("Helvetica", 40)
    can.setFillColorRGB(0.5, 0.5, 0.5, 0.5)
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

    for i, page in enumerate(reader.pages):
        page.merge_page(watermark_page)
        writer.add_page(page)
        downloads[task_id]['progress'] = (i / len(reader.pages)) * 90

    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    with open(output_path, 'wb') as f:
        writer.write(f)
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/add-watermark', methods=['POST'])
def add_watermark():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    text = request.form.get('text', 'Watermark')
    if file.filename == '': return jsonify({'error': 'No file selected'}), 400

    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_wm_in.pdf")
    file.save(input_path)
    output_filename = f"{task_id}_watermarked.pdf"

    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, add_watermark_task, input_path, output_filename, text)).start()
    
    return jsonify({'success': True, 'task_id': task_id})

# 8. Add Signature
def add_signature_task(task_id, input_path, sig_path, output_filename, x, y, width, height, page_num):
    from PyPDF2 import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas
    import io
    from PIL import Image
    
    reader = PdfReader(input_path)
    writer = PdfWriter()
    
    if not (0 <= page_num < len(reader.pages)):
        raise Exception('Invalid page index')
        
    page_width = float(reader.pages[page_num].mediabox.width)
    page_height = float(reader.pages[page_num].mediabox.height)
    
    def norm(v, size):
        return float(v) * size if float(v) <= 1.0 else float(v)
    
    x = norm(x, page_width)
    y = norm(y, page_height)
    w = norm(width, page_width)
    h = norm(height, page_height)
    y_pdf = page_height - y - h
    
    packet = io.BytesIO()
    can = canvas.Canvas(packet, pagesize=(page_width, page_height))
    can.drawImage(sig_path, x, y_pdf, width=w, height=h, mask='auto')
    can.save()
    packet.seek(0)
    
    sig_pdf = PdfReader(packet)
    sig_page = sig_pdf.pages[0]
    
    for i, page in enumerate(reader.pages):
        if i == page_num:
            page.merge_page(sig_page)
        writer.add_page(page)
        downloads[task_id]['progress'] = (i / len(reader.pages)) * 90

    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    with open(output_path, 'wb') as f:
        writer.write(f)
        
    if os.path.exists(input_path): os.remove(input_path)
    if os.path.exists(sig_path): os.remove(sig_path)
    return output_filename

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

    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_in.pdf")
    sig_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_sig.png")
    file.save(input_path)
    signature.save(sig_path)
    output_filename = f"{task_id}_signed.pdf"

    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, add_signature_task, input_path, sig_path, output_filename, x, y, width, height, page_num)).start()
    
    return jsonify({'success': True, 'task_id': task_id})

# 9. Edit PDF (Add Text Annotation)
def edit_pdf_task(task_id, input_path, output_filename, text, x, y, page_num, fontsize, color):
    import fitz
    doc = fitz.open(input_path)
    if 0 <= page_num < len(doc):
        page = doc[page_num]
        r, g, b = map(float, color.split(','))
        if r > 1 or g > 1 or b > 1: r, g, b = r/255, g/255, b/255
        if x <= 1.0 and y <= 1.0:
             x = x * page.rect.width
             y = y * page.rect.height
        page.insert_text((x, y), text, fontsize=fontsize, color=(r, g, b))
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    doc.save(output_path)
    doc.close()
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/edit-pdf', methods=['POST'])
def edit_pdf():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    text = request.form.get('text', '')
    x = float(request.form.get('x', 100))
    y = float(request.form.get('y', 100))
    page_num = int(request.form.get('page', 0))
    fontsize = int(request.form.get('fontsize', 11))
    color = request.form.get('color', '0,0,0')
    if file.filename == '': return jsonify({'error': 'No file selected'}), 400
    
    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_in.pdf")
    file.save(input_path)
    output_filename = f"{task_id}_edited.pdf"
    
    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, edit_pdf_task, input_path, output_filename, text, x, y, page_num, fontsize, color)).start()
    return jsonify({'success': True, 'task_id': task_id})

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

@app.route('/api/reviews', methods=['GET', 'POST'])
def handle_reviews():
    from datetime import datetime # Added as per instruction
    if request.method == 'GET':
        try:
            if os.path.exists(REVIEWS_FILE):
                with open(REVIEWS_FILE, 'r') as f:
                    reviews = json.load(f)
                    return jsonify(reviews)
            return jsonify([])
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'No data provided'}), 400
            
            # Get fields from frontend
            name = data.get('name', 'Anonyme')
            text = data.get('text', '')
            rating = data.get('rating', 5)
            
            # Validation
            if not text or len(text.strip()) == 0:
                return jsonify({'error': 'Le texte de l\'avis est requis'}), 400
            
            if not isinstance(rating, int) or not (1 <= rating <= 5):
                return jsonify({'error': 'La note doit être entre 1 et 5'}), 400

            # Generate initials
            def get_initials(name):
                parts = name.strip().split()
                if not parts: return "A"
                if len(parts) == 1:
                    return parts[0][0].upper()
                return (parts[0][0] + parts[1][0]).upper()

            review_entry = {
                'id': str(uuid.uuid4()),
                'name': name,
                'text': text,
                'rating': rating,
                'initials': get_initials(name),
                'date': datetime.now().isoformat()
            }

            reviews = []
            reviews = []
            if os.path.exists(REVIEWS_FILE):
                try:
                    with open(REVIEWS_FILE, 'r', encoding='utf-8') as f:
                        reviews = json.load(f)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    # File might be empty, corrupted, or have wrong encoding (e.g. UTF-16)
                    # Try reading with 'utf-16' just in case, or just reset
                    try:
                        with open(REVIEWS_FILE, 'r', encoding='utf-16') as f:
                            reviews = json.load(f)
                    except:
                        reviews = [] # If all else fails, start fresh

            reviews.insert(0, review_entry)
            reviews = reviews[:100]

            with open(REVIEWS_FILE, 'w', encoding='utf-8') as f:
                json.dump(reviews, f, indent=2, ensure_ascii=False)
            
            return jsonify({'success': True, 'review': review_entry}), 201
        except Exception as e:
            print(f"Error submitting review: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': 'Erreur serveur', 'details': str(e)}), 500

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

def img_to_pdf_task(task_id, input_path, output_filename):
    import img2pdf
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    with open(output_path, "wb") as f:
        f.write(img2pdf.convert(input_path))
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/img-to-pdf', methods=['POST'])
def img_to_pdf():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({'error': 'No file selected'}), 400
    
    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_{secure_filename(file.filename)}")
    file.save(input_path)
    output_filename = f"{task_id}_converted.pdf"

    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, img_to_pdf_task, input_path, output_filename)).start()
    return jsonify({'success': True, 'task_id': task_id})

def word_to_pdf_task(task_id, input_path, output_filename):
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    input_path_abs = os.path.abspath(input_path)
    output_path_abs = os.path.abspath(output_path)
    
    if os.name == 'nt':
        from docx2pdf import convert
        convert(input_path_abs, output_path_abs)
    else:
        import subprocess
        cmd = ['libreoffice', '--headless', '--convert-to', 'pdf', '--outdir', DOWNLOAD_FOLDER, input_path]
        subprocess.run(cmd, check=True)
        lo_output = os.path.splitext(input_path)[0] + ".pdf"
        if os.path.exists(lo_output): os.rename(lo_output, output_path)
        
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/word-to-pdf', methods=['POST'])
def word_to_pdf():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if not file.filename.endswith(('.docx', '.doc')): return jsonify({'error': 'Invalid file type'}), 400
    
    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_{secure_filename(file.filename)}")
    file.save(input_path)
    output_filename = f"{task_id}_converted.pdf"

    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, word_to_pdf_task, input_path, output_filename)).start()
    return jsonify({'success': True, 'task_id': task_id})

def ppt_to_pdf_task(task_id, input_path, output_filename):
    output_path = os.path.abspath(os.path.join(DOWNLOAD_FOLDER, output_filename))
    if os.name == 'nt':
        import comtypes.client
        powerpoint = comtypes.client.CreateObject("Powerpoint.Application")
        deck = powerpoint.Presentations.Open(input_path)
        deck.SaveAs(output_path, 32)
        deck.Close()
        powerpoint.Quit()
    else:
        import subprocess
        cmd = ['libreoffice', '--headless', '--convert-to', 'pdf', '--outdir', DOWNLOAD_FOLDER, input_path]
        subprocess.run(cmd, check=True)
        lo_output = os.path.splitext(input_path)[0] + ".pdf"
        if os.path.exists(lo_output): os.rename(lo_output, output_path)
        
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/ppt-to-pdf', methods=['POST'])
def ppt_to_pdf():
    if 'file' not in request.files: return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    
    task_id = str(uuid.uuid4())
    input_path = os.path.abspath(os.path.join(DOWNLOAD_FOLDER, f"{task_id}_{secure_filename(file.filename)}"))
    file.save(input_path)
    output_filename = f"{task_id}_converted.pdf"

    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, ppt_to_pdf_task, input_path, output_filename)).start()
    return jsonify({'success': True, 'task_id': task_id})

def unlock_pdf_task(task_id, input_path, output_filename, password):
    import pikepdf
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
    with pikepdf.open(input_path, password=password) as pdf:
        pdf.save(output_path)
    if os.path.exists(input_path): os.remove(input_path)
    return output_filename

@app.route('/api/unlock-pdf', methods=['POST'])
def unlock_pdf():
    file = request.files.get('file')
    password = request.form.get('password')
    if not file or not password: return jsonify({'error': 'Missing file or password'}), 400
    
    task_id = str(uuid.uuid4())
    input_path = os.path.join(DOWNLOAD_FOLDER, f"{task_id}_in.pdf")
    file.save(input_path)
    output_filename = f"{task_id}_unlocked.pdf"

    downloads[task_id] = {'status': 'pending', 'progress': 0}
    threading.Thread(target=tool_worker_wrapper, args=(task_id, unlock_pdf_task, input_path, output_filename, password)).start()
    return jsonify({'success': True, 'task_id': task_id})

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
    bin_path = os.path.join(os.getcwd(), 'bin')
    os.environ['PATH'] += os.pathsep + bin_path
    
    # System Binaries
    deps = {'ffmpeg': 'Critical', 'ffprobe': 'Critical'}
    missing = []
    from shutil import which
    for dep, desc in deps.items():
        if not which(dep):
            missing.append(f"{dep} ({desc})")
            print(f"❌ {dep} NOT FOUND")
        else:
            print(f"✅ {dep} found")
            
    # Python Libraries
    python_libs = {
        'rembg': 'Background Removal',
        'cv2': 'Watermark Removal (OpenCV)',
        'moviepy': 'Video Conversion',
        'PIL': 'Image processing'
    }
    for lib, name in python_libs.items():
        try:
            __import__(lib)
            print(f"✅ {name} (Python) found")
        except ImportError:
            missing.append(f"{lib} (Python Library)")
            print(f"❌ {name} NOT INSTALLED")

    if missing:
        print("WARNING: Some dependencies are missing!")
        print(f"Missing: {', '.join(missing)}")
    else:
        print("All dependencies check out.")
    print("-----------------------------------------------------------")

if __name__ == '__main__':
    print("------------------ SERVER STARTING ------------------")
    check_dependencies()
    # For local development only
    app.run(debug=True, use_reloader=False, port=5000)
# For production (Gunicorn), the app object is used directly
