import pandas as pd
import requests
import time
import threading
import tkinter as tk
from tkinter import ttk
import os
import sys
import io
from queue import Queue, Empty
import json

# Default values that can be overridden at build time
# These will be replaced by build script
try:
    from build_config import DEFAULT_API_HOST, DEFAULT_API_KEY
except ImportError:
    DEFAULT_API_HOST = "http://localhost:8080"
    DEFAULT_API_KEY = ""

class ISBNProcessor:
    def __init__(self, input_file="input.xlsx", output_file="output.xlsx", 
                 interval=5, api_key=None, api_host=None):
        self.input_file = input_file
        self.output_file = output_file
        self.interval = interval
        self.api_key = api_key if api_key is not None else DEFAULT_API_KEY
        self.api_host = api_host if api_host is not None else DEFAULT_API_HOST.rstrip('/')
        self.running = False
        self.session = requests.Session()
        
        # Create input if missing
        try:
            pd.read_excel(input_file)
        except Exception:
            pd.DataFrame(columns=['isbn']).to_excel(input_file, index=False)
            print(f"Created {input_file}")
    
    def get_title(self, isbn):
        isbn_str = str(isbn).strip()
        if not isbn_str:
            return "not found (empty)"
        
        try:
            url = f"{self.api_host}/{isbn_str}/title"
            headers = {}
            if self.api_key:
                headers['ISBNDB_API_KEY'] = self.api_key
            
            response = self.session.get(url, headers=headers, timeout=5)
            
            if response.status_code < 200 or response.status_code > 299:
                return f"not found ({response.status_code})"
            
            try:
                data = response.json()
            except Exception:
                return "not found"
            
            if isinstance(data, list) and data:
                item = data[0]
                if isinstance(item, dict):
                    title = item.get('title')
                    if title:
                        return title
                    else:
                        return "not found"
                else:
                    return str(item)
            else:
                return "not found"
                
        except Exception as e:
            print(e)
            return "not found (error)"
    
    def process(self):
        try:
            # Read input
            df = pd.read_excel(self.input_file)
            
            # Find isbn column (case-insensitive)
            isbn_col = None
            for col in df.columns:
                if str(col).strip().lower() == 'isbn':
                    isbn_col = col
                    break
            
            if not isbn_col:
                print("Error: No 'isbn' column found in input file")
                return
            
            # Load existing output if it exists
            existing_titles = {}
            try:
                out_df = pd.read_excel(self.output_file)
                if 'book title' in out_df.columns and isbn_col in out_df.columns:
                    for idx, row in out_df.iterrows():
                        isbn_val = row[isbn_col]
                        if pd.notna(isbn_val):
                            existing_titles[str(isbn_val).strip()] = row.get('book title', '')
            except Exception:
                pass  # File doesn't exist or is corrupted
            
            # Process rows
            results = []
            fetched = 0
            failed = 0
            
            for _, row in df.iterrows():
                isbn_val = row[isbn_col] if isbn_col in row else None
                
                if pd.isna(isbn_val):
                    title = "not found (empty)"
                else:
                    isbn_key = str(isbn_val).strip()
                    # Check existing titles first
                    if isbn_key in existing_titles:
                        title = existing_titles[isbn_key]
                    else:
                        title = self.get_title(isbn_val)
                        if "not found" in title:
                            failed += 1
                        else:
                            fetched += 1
                
                new_row = row.copy()
                new_row['book title'] = title
                results.append(new_row)
            
            # Create output DataFrame
            out_df = pd.DataFrame(results)
            
            # Save
            out_df.to_excel(self.output_file, index=False)
            
            print(f"\nSummary:")
            if fetched:
                print(f"  Successfully fetched: {fetched} titles")
            if failed:
                print(f"  Failed to fetch: {failed} titles")
            print(f"  Total rows: {len(out_df)}")
            print(f"  Saved to: {self.output_file}")
            
        except Exception as e:
            print(f"Error processing file: {e}")
    
    def run(self):
        self.running = True
        print("Running...")
        print(f"API Host: {self.api_host}")
        if self.api_key:
            print(f"Using API key: {self.api_key[:8]}...")
        print()
        
        while self.running:
            self.process()
            if not self.running:
                break
            
            # Sleep in small increments to check for stop signal
            for _ in range(self.interval * 10):
                time.sleep(0.1)
        
        print("Stopped.")
    
    def stop(self):
        self.running = False

class App:
    def __init__(self, root):
        self.root = root
        self.root.title("ISBN Lookup Excel Desktop UI")
        self.root.geometry("800x840")
        self.root.minsize(800, 760)
        
        # Configure grid weights for responsiveness
        root.grid_columnconfigure(1, weight=1)
        root.grid_columnconfigure(2, weight=0)
        root.grid_rowconfigure(6, weight=1)
        
        # Create a main frame for better organization
        main_frame = ttk.Frame(root, padding="10")
        main_frame.grid(row=0, column=0, columnspan=3, sticky="nsew")
        
        # Configure main_frame grid
        main_frame.grid_columnconfigure(1, weight=1)
        main_frame.grid_rowconfigure(6, weight=1)
        
        # Input file
        ttk.Label(main_frame, text="Input File:").grid(row=0, column=0, sticky="w", pady=5)
        self.input_var = tk.StringVar(value="input.xlsx")
        self.input_entry = ttk.Entry(main_frame, textvariable=self.input_var)
        self.input_entry.grid(row=0, column=1, sticky="ew", padx=(5, 0), pady=5)
        ttk.Button(main_frame, text="Browse...", width=10, 
                  command=lambda: self.browse_file(self.input_var)).grid(row=0, column=2, padx=(5, 0), pady=5)
        
        # Output file
        ttk.Label(main_frame, text="Output File:").grid(row=1, column=0, sticky="w", pady=5)
        self.output_var = tk.StringVar(value="output.xlsx")
        self.output_entry = ttk.Entry(main_frame, textvariable=self.output_var)
        self.output_entry.grid(row=1, column=1, sticky="ew", padx=(5, 0), pady=5)
        ttk.Button(main_frame, text="Browse...", width=10,
                  command=lambda: self.browse_file(self.output_var, save=True)).grid(row=1, column=2, padx=(5, 0), pady=5)
        
        # API Host - Use DEFAULT_API_HOST as default
        ttk.Label(main_frame, text="API Host:").grid(row=2, column=0, sticky="w", pady=5)
        self.host_var = tk.StringVar(value=DEFAULT_API_HOST)
        ttk.Entry(main_frame, textvariable=self.host_var).grid(row=2, column=1, columnspan=2, sticky="ew", padx=(5, 0), pady=5)
        
        # API Key - Use DEFAULT_API_KEY as default
        ttk.Label(main_frame, text="API Key:").grid(row=3, column=0, sticky="w", pady=5)
        self.key_var = tk.StringVar(value=DEFAULT_API_KEY)
        self.key_entry = ttk.Entry(main_frame, textvariable=self.key_var, show="*")
        self.key_entry.grid(row=3, column=1, sticky="ew", padx=(5, 0), pady=5)
        
        # Show/Hide API Key button
        self.show_key_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(main_frame, text="Show", variable=self.show_key_var,
                       command=self.toggle_key_visibility).grid(row=3, column=2, padx=(5, 0), pady=5, sticky="w")
        
        # Interval
        ttk.Label(main_frame, text="Interval (seconds):").grid(row=4, column=0, sticky="w", pady=5)
        self.interval_var = tk.StringVar(value="5")
        ttk.Entry(main_frame, textvariable=self.interval_var, width=10).grid(row=4, column=1, sticky="w", padx=(5, 0), pady=5)
        
        # Button frame
        button_frame = ttk.Frame(main_frame)
        button_frame.grid(row=5, column=0, columnspan=3, pady=15, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=1)
        button_frame.grid_columnconfigure(1, weight=1)
        
        # Start/Stop buttons
        self.start_btn = ttk.Button(button_frame, text="Start Processing", command=self.start)
        self.start_btn.grid(row=0, column=0, padx=(0, 5), sticky="ew")
        self.stop_btn = ttk.Button(button_frame, text="Stop Processing", command=self.stop, state="disabled")
        self.stop_btn.grid(row=0, column=1, padx=(5, 0), sticky="ew")
        
        # Status label
        self.status_var = tk.StringVar(value="Ready")
        self.status_label = ttk.Label(button_frame, textvariable=self.status_var)
        self.status_label.grid(row=1, column=0, columnspan=2, pady=(10, 0))
        
        # Text area for output
        text_frame = ttk.LabelFrame(main_frame, text="Processing Log", padding="5")
        text_frame.grid(row=6, column=0, columnspan=3, sticky="nsew", pady=(10, 0))
        text_frame.grid_columnconfigure(0, weight=1)
        text_frame.grid_rowconfigure(0, weight=1)
        
        self.text = tk.Text(text_frame, height=15, wrap=tk.WORD)
        self.text.grid(row=0, column=0, sticky="nsew")
        
        # Scrollbars
        text_scrollbar = ttk.Scrollbar(text_frame, orient="vertical", command=self.text.yview)
        text_scrollbar.grid(row=0, column=1, sticky="ns")
        self.text.config(yscrollcommand=text_scrollbar.set)
        
        text_hscrollbar = ttk.Scrollbar(text_frame, orient="horizontal", command=self.text.xview)
        text_hscrollbar.grid(row=1, column=0, columnspan=2, sticky="ew")
        self.text.config(xscrollcommand=text_hscrollbar.set)
        
        # Queue for thread-safe GUI updates
        self.queue = Queue()
        self.processor = None
        self.processor_thread = None
        
        # Start periodic queue check
        self.check_queue()
    
    def browse_file(self, var, save=False):
        """Open file dialog for browsing files"""
        from tkinter import filedialog
        
        if save:
            filename = filedialog.asksaveasfilename(
                defaultextension=".xlsx",
                filetypes=[("Excel files", "*.xlsx"), ("All files", "*.*")]
            )
        else:
            filename = filedialog.askopenfilename(
                filetypes=[("Excel files", "*.xlsx"), ("All files", "*.*")]
            )
        
        if filename:
            var.set(filename)
    
    def toggle_key_visibility(self):
        show = self.show_key_var.get()
        self.key_entry.config(show="" if show else "*")
    
    def check_queue(self):
        """Check for messages from threads"""
        try:
            while True:
                msg = self.queue.get_nowait()
                self.text.insert(tk.END, msg)
                self.text.see(tk.END)
        except Empty:
            pass
        self.root.after(100, self.check_queue)
    
    def log_message(self, message):
        """Add a message to the text widget via queue"""
        self.queue.put(message)
    
    def start(self):
        if not self.processor_thread or not self.processor_thread.is_alive():
            # Validate interval
            try:
                interval = int(self.interval_var.get())
                if interval <= 0:
                    self.log_message("Error: Interval must be positive\n")
                    self.status_var.set("Error: Invalid interval")
                    return
            except ValueError:
                self.log_message("Error: Interval must be a number\n")
                self.status_var.set("Error: Invalid interval")
                return
            
            self.start_btn.config(state="disabled")
            self.stop_btn.config(state="normal")
            self.status_var.set("Processing...")
            
            # Clear previous output
            self.text.delete(1.0, tk.END)
            
            # Create processor
            self.processor = ISBNProcessor(
                input_file=self.input_var.get(),
                output_file=self.output_var.get(),
                interval=interval,
                api_key=self.key_var.get() or None,
                api_host=self.host_var.get()
            )
            
            # Start processor in separate thread
            self.processor_thread = threading.Thread(target=self._run_processor, daemon=True)
            self.processor_thread.start()
    
    def _run_processor(self):
        """Wrapper to redirect print output to GUI"""
        import builtins
        original_print = builtins.print
        
        def custom_print(*args, **kwargs):
            text = " ".join(str(arg) for arg in args)
            if kwargs.get('end', '\n') == '\n':
                text += '\n'
            self.queue.put(text)
            # Keep original output for debugging
            original_print(*args, **kwargs)
        
        builtins.print = custom_print
        
        try:
            self.processor.run()
        finally:
            builtins.print = original_print
            self.root.after(0, self._on_processor_stop)
    
    def _on_processor_stop(self):
        """Called when processor thread stops"""
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.status_var.set("Ready")
    
    def stop(self):
        if self.processor:
            self.processor.stop()
            self.status_var.set("Stopping...")

if __name__ == "__main__":
    # Set ttk theme for better appearance
    try:
        from ctypes import windll
        windll.shcore.SetProcessDpiAwareness(1)  # For Windows DPI scaling
    except:
        pass
    
    root = tk.Tk()
    
    # Set ttk style
    style = ttk.Style()
    style.theme_use('clam')
    
    app = App(root)
    
    # Handle window close
    def on_closing():
        if app.processor:
            app.processor.stop()
        root.destroy()
    
    root.protocol("WM_DELETE_WINDOW", on_closing)
    
    root.update_idletasks()
    root.mainloop()