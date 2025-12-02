import os
import zipfile
import shutil
import urllib.request
import sys

def setup_ffmpeg():
    # URL for a reliable static build of ffmpeg for Windows
    FFMPEG_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    bin_dir = os.path.join(base_dir, 'bin')
    zip_path = os.path.join(base_dir, 'ffmpeg.zip')
    
    if not os.path.exists(bin_dir):
        os.makedirs(bin_dir)
        
    ffmpeg_exe = os.path.join(bin_dir, 'ffmpeg.exe')
    
    if os.path.exists(ffmpeg_exe):
        print("FFmpeg already exists in bin folder.")
        return

    print(f"Downloading FFmpeg from {FFMPEG_URL}...")
    try:
        urllib.request.urlretrieve(FFMPEG_URL, zip_path)
        print("Download complete. Extracting...")
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Find the bin folder inside the zip
            for file in zip_ref.namelist():
                if file.endswith('bin/ffmpeg.exe'):
                    source = zip_ref.open(file)
                    target = open(os.path.join(bin_dir, 'ffmpeg.exe'), "wb")
                    with source, target:
                        shutil.copyfileobj(source, target)
                    print("Extracted ffmpeg.exe")
                elif file.endswith('bin/ffprobe.exe'):
                    source = zip_ref.open(file)
                    target = open(os.path.join(bin_dir, 'ffprobe.exe'), "wb")
                    with source, target:
                        shutil.copyfileobj(source, target)
                    print("Extracted ffprobe.exe")
                    
        print("Cleanup...")
        os.remove(zip_path)
        print("FFmpeg setup complete!")
        
    except Exception as e:
        print(f"Error setting up FFmpeg: {e}")
        if os.path.exists(zip_path):
            os.remove(zip_path)

if __name__ == "__main__":
    setup_ffmpeg()
