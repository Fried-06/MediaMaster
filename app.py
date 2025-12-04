import os
import uuid
import threading
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import yt_dlp
from moviepy.editor import VideoFileClip
from gtts import gTTS

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configuration
DOWNLOAD_FOLDER = os.path.join(os.getcwd(), 'downloads')
if not os.path.exists(DOWNLOAD_FOLDER):
    os.makedirs(DOWNLOAD_FOLDER)

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

if __name__ == '__main__':
    print("------------------ SERVER STARTING ------------------")
    # For local development only
    app.run(debug=True, use_reloader=False, port=5000)
# For production (Gunicorn), the app object is used directly
