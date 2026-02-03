#!/usr/bin/env python3
"""
XYZ V3 Protocol File Upload Script
Implements the block-transfer protocol for Da Vinci printers
Based on miniMover C++ implementation
"""

import sys
import os
import serial
import time
import struct
import argparse

BLOCK_SIZE = 8192  # 8KB blocks
TIMEOUT = 30  # 30 second timeout for responses

def wait_for_ok(ser, timeout=TIMEOUT):
    """Wait for 'ok' response from printer"""
    start = time.time()
    buffer = ""
    
    while time.time() - start < timeout:
        if ser.in_waiting > 0:
            byte = ser.read(1).decode('utf-8', errors='ignore')
            buffer += byte
            
            if '\n' in buffer:
                lines = buffer.split('\n')
                for line in lines[:-1]:
                    line = line.strip()
                    if line:
                        print(f"  << {line}", file=sys.stderr)
                        if line == "ok":
                            return True
                buffer = lines[-1]
    
    return False

def send_command(ser, command):
    """Send command and wait for ok"""
    print(f"  >> {command}", file=sys.stderr)
    ser.write((command + '\n').encode('utf-8'))
    ser.flush()
    return wait_for_ok(ser)

def upload_file(serial_port, gcode_file, progress_callback=None):
    """Upload G-code file to printer using XYZ V3 protocol"""
    
    # Get file size
    file_size = os.path.getsize(gcode_file)
    filename = os.path.basename(gcode_file)
    
    print(f"Uploading {filename} ({file_size} bytes) to {serial_port}", file=sys.stderr)
    
    # Open serial port
    try:
        ser = serial.Serial(
            port=serial_port,
            baudrate=115200,
            timeout=1,
            write_timeout=1
        )
        time.sleep(0.5)  # Let port stabilize
    except Exception as e:
        print(f"ERROR: Failed to open serial port: {e}", file=sys.stderr)
        return False
    
    try:
        # Step 1: Send upload init command
        init_cmd = f"XYZv3/upload={filename},{file_size}"
        print(f"\n[1/3] Initializing upload...", file=sys.stderr)
        if not send_command(ser, init_cmd):
            print("ERROR: Failed to initialize upload (no ok response)", file=sys.stderr)
            return False
        
        # Step 2: Send file in blocks
        print(f"\n[2/3] Transferring data in {BLOCK_SIZE}-byte blocks...", file=sys.stderr)
        block_index = 0
        bytes_sent = 0
        
        with open(gcode_file, 'rb') as f:
            while True:
                data = f.read(BLOCK_SIZE)
                if not data:
                    break
                
                data_size = len(data)
                
                # Build frame: [Index(4b)][Size(4b)][Data][Trailer(4b)]
                # Trailer = Index XOR 0x5A5AA5A5
                trailer = block_index ^ 0x5A5AA5A5
                
                frame = struct.pack('<I', block_index)  # Index (little-endian uint32)
                frame += struct.pack('<I', data_size)   # Size (little-endian uint32)
                frame += data                           # Data
                frame += struct.pack('<I', trailer)     # Trailer (little-endian uint32)
                
                # Send frame
                ser.write(frame)
                ser.flush()
                
                # Wait for ok
                if not wait_for_ok(ser):
                    print(f"\nERROR: Failed to send block {block_index} (no ok response)", file=sys.stderr)
                    return False
                
                bytes_sent += data_size
                block_index += 1
                
                # Progress reporting
                progress = int((bytes_sent / file_size) * 100)
                print(f"\r  Progress: {progress}% ({bytes_sent}/{file_size} bytes, block {block_index})", end='', file=sys.stderr)
                
                if progress_callback:
                    progress_callback(progress)
        
        print(f"\n  Sent {block_index} blocks total", file=sys.stderr)
        
        # Step 3: Finalize upload
        print(f"\n[3/3] Finalizing upload...", file=sys.stderr)
        if not send_command(ser, "XYZv3/uploadDidFinish"):
            print("ERROR: Failed to finalize upload (no ok response)", file=sys.stderr)
            return False
        
        print(f"\nSUCCESS: File uploaded successfully!", file=sys.stderr)
        return True
        
    except Exception as e:
        print(f"\nERROR: Upload failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return False
    finally:
        ser.close()

def main():
    parser = argparse.ArgumentParser(description='Upload G-code to Da Vinci printer via XYZ V3 protocol')
    parser.add_argument('-c', '--serial', required=True, help='Serial port (e.g., /dev/ttyACM0)')
    parser.add_argument('-p', '--file', required=True, help='G-code file to upload')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.file):
        print(f"ERROR: File not found: {args.file}", file=sys.stderr)
        sys.exit(1)
    
    success = upload_file(args.serial, args.file)
    sys.exit(0 if success else 1)

if __name__ == '__main__':
    main()
