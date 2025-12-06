# Use official Python runtime as a parent image
FROM python:3.11-slim

# Install system dependencies including ffmpeg and poppler for PDF tools
RUN apt-get update && \
    apt-get install -y ffmpeg git poppler-utils && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN useradd -m -u 1000 user

# Switch to the non-root user
USER user

# Set environment variables
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PORT=7860

# Set the working directory to the user's home directory
WORKDIR $HOME/app

# Copy the requirements file
COPY --chown=user requirements.txt $HOME/app/requirements.txt

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY --chown=user . $HOME/app

# Expose the port
EXPOSE 7860

# Run gunicorn
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:7860", "--workers", "2", "--timeout", "120"]
