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
from datetime import datetime
from typing import Optional, Dict, Any, Tuple, List
from dataclasses import dataclass

try:
    from build_config import DEFAULT_API_HOST, DEFAULT_API_KEY
except ImportError:
    DEFAULT_API_HOST = "http://localhost:8080"
    DEFAULT_API_KEY = ""

@dataclass
class ProcessingConfig:
    """Configuration for ISBN processing"""
    input_file: str = "input.xlsx"
    output_file: str = "output.xlsx"
    interval_seconds: int = 0
    api_key: Optional[str] = None
    api_host: str = DEFAULT_API_HOST.rstrip('/')
    monitor_file_changes: bool = True

@dataclass
class ProcessingStats:
    """Statistics for a processing run"""
    total_rows: int = 0
    titles_fetched: int = 0
    titles_failed: int = 0
    start_time: Optional[str] = None

def normalize_isbn_string(isbn_value: Any) -> str:
    """Convert ISBN to standardized string format"""
    if pd.isna(isbn_value):
        return ""
    
    isbn_str = str(isbn_value).strip()
    
    try:
        if '.' in isbn_str:
            num = float(isbn_str)
            if num.is_integer():
                isbn_str = str(int(num))
        elif isbn_str.endswith('.0'):
            isbn_str = isbn_str[:-2]
    except (ValueError, AttributeError):
        pass
    
    return isbn_str

def fetch_book_title_from_api(
    isbn: Any,
    api_host: str,
    api_key: Optional[str],
    session: requests.Session
) -> str:
    """Fetch book title from ISBN using API"""
    if pd.isna(isbn):
        return "not found (empty)"
    
    isbn_str = normalize_isbn_string(isbn)
    if not isbn_str:
        return "not found (empty)"
    
    try:
        url = f"{api_host}/{isbn_str}/title"
        headers = {}
        if api_key:
            headers['ISBNDB_API_KEY'] = api_key
        
        response = session.get(url, headers=headers, timeout=300)
        
        if not 200 <= response.status_code <= 299:
            return f"not found ({response.status_code})"
        
        try:
            data = response.json()
            if isinstance(data, list) and data:
                item = data[0]
                if isinstance(item, dict):
                    title = item.get('title')
                    if title:
                        return title
            return "not found"
        except ValueError:
            return "not found"
            
    except Exception as e:
        print(f"API error for ISBN {isbn_str}: {e}")
        return "not found (error)"

def has_file_changed(filepath: str, last_modified_time: Optional[float]) -> Tuple[bool, Optional[float]]:
    """Check if a file has been modified since last check"""
    try:
        current_modified_time = os.path.getmtime(filepath)
        if last_modified_time is None:
            return True, current_modified_time
        elif current_modified_time != last_modified_time:
            return True, current_modified_time
        return False, last_modified_time
    except Exception as e:
        print(f"Error checking file modification: {e}")
        return True, last_modified_time

def find_isbn_column_in_dataframe(df: pd.DataFrame) -> Optional[str]:
    """Find the ISBN column in a DataFrame (case-insensitive)"""
    for column in df.columns:
        if str(column).strip().lower() == 'isbn':
            return column
    return None

def load_existing_titles_from_output_file(
    output_filepath: str,
    isbn_column_name: str
) -> Dict[str, str]:
    """Load previously fetched titles from output file"""
    existing_titles = {}
    
    try:
        output_df = pd.read_excel(output_filepath, dtype=str)
        
        if 'title' in output_df.columns and isbn_column_name in output_df.columns:
            output_df[isbn_column_name] = output_df[isbn_column_name].apply(normalize_isbn_string)
            
            for _, row in output_df.iterrows():
                isbn_val = row[isbn_column_name]
                if pd.notna(isbn_val) and str(isbn_val).strip():
                    isbn_key = str(isbn_val).strip()
                    existing_titles[isbn_key] = row.get('title', '')
                    
    except Exception:
        pass
    
    return existing_titles

def process_single_row(
    row: pd.Series,
    isbn_column_name: str,
    api_host: str,
    api_key: Optional[str],
    session: requests.Session,
    existing_titles_cache: Dict[str, str],
    stats: ProcessingStats
) -> pd.Series:
    """Process a single row and fetch title if needed"""
    isbn_value = row[isbn_column_name] if isbn_column_name in row else None
    isbn_normalized = normalize_isbn_string(isbn_value)
    
    if pd.isna(isbn_value) or not isbn_normalized:
        title = "not found (empty)"
        print(f"  ISBN: [empty] -> {title}")
    else:
        if isbn_normalized in existing_titles_cache:
            title = existing_titles_cache[isbn_normalized]
            if isbn_normalized == 'bad':
                print(existing_titles_cache[isbn_normalized])
        else:
            title = fetch_book_title_from_api(isbn_value, api_host, api_key, session)
            if "not found" in title:
                stats.titles_failed += 1
            else:
                stats.titles_fetched += 1
            print(f"  ISBN: {isbn_normalized} -> {title}")
    
    result_row = row.copy()
    result_row['title'] = title
    return result_row

def print_processing_summary(stats: ProcessingStats, output_filepath: str) -> None:
    """Print summary of processing results"""
    current_time = datetime.now().strftime("%H:%M:%S")
    summary_msg = f"\n[{current_time}] Summary:"
    
    if stats.titles_fetched:
        summary_msg += f"\n  Successfully fetched: {stats.titles_fetched} titles"
    if stats.titles_failed:
        summary_msg += f"\n  Failed to fetch: {stats.titles_failed} titles"
    
    summary_msg += f"\n  Total rows: {stats.total_rows}"
    summary_msg += f"\n  Saved to: {output_filepath}"
    print(summary_msg)

def process_isbn_file(
    config: ProcessingConfig,
    session: requests.Session,
    last_modified_time: Optional[float]
) -> Tuple[Optional[float], ProcessingStats]:
    """Main function to process ISBN file and fetch titles"""
    stats = ProcessingStats(start_time=datetime.now().strftime("%H:%M:%S"))
    
    # Check if file has changed
    if config.monitor_file_changes:
        file_changed, new_modified_time = has_file_changed(
            config.input_file, last_modified_time
        )
        if not file_changed:
            return last_modified_time, stats
        last_modified_time = new_modified_time
    
    # Read input file
    try:
        input_df = pd.read_excel(config.input_file, dtype=str)
    except Exception as e:
        print(f"Error reading with dtype=str: {e}, trying default read")
        input_df = pd.read_excel(config.input_file)
    
    # Find ISBN column
    isbn_column = find_isbn_column_in_dataframe(input_df)
    if not isbn_column:
        print("Error: No 'isbn' column found in input file")
        return last_modified_time, stats
    
    # Normalize ISBNs in input
    input_df[isbn_column] = input_df[isbn_column].apply(normalize_isbn_string)

    # Load existing titles from output file
    existing_titles = load_existing_titles_from_output_file(
        config.output_file, isbn_column
    )
    
    print(f"\n[{stats.start_time}] Processing...")
    
    # Process each row
    processed_rows = []
    for _, row in input_df.iterrows():
        
        processed_row = process_single_row(
            row, isbn_column, config.api_host, config.api_key,
            session, existing_titles, stats
        )
        processed_rows.append(processed_row)

    # Account for manual fixes to "not found" items the user may have made in the output file while processing was ongoing
    existing_titles_final = load_existing_titles_from_output_file(
        config.output_file, isbn_column
    )
    for i, row in enumerate(processed_rows):
        isbn_val = row[isbn_column] if isbn_column in row else None
        isbn_normalized = normalize_isbn_string(isbn_val)
        if isbn_normalized in existing_titles_final:
            final_title = existing_titles_final[isbn_normalized]
            current_title = row.get('title', '')
            if (final_title != current_title and "not found" not in final_title.lower()):
                processed_rows[i]['title'] = final_title
                print(f"  Note: title manually entered mid-process for ISBN {isbn_normalized}: {final_title}")
    
    # Create and save output DataFrame
    output_df = pd.DataFrame(processed_rows)
    output_df.to_excel(config.output_file, index=False)
    
    stats.total_rows = len(output_df)
    print_processing_summary(stats, config.output_file)
    
    return last_modified_time, stats

class ISBNProcessor:
    """Manages ISBN processing with state"""
    
    def __init__(self, config: ProcessingConfig):
        self.config = config
        self.running = False
        self.session = requests.Session()
        self.last_modified_time = None

        try:
            pd.read_excel(config.input_file)
        except Exception:
            pd.DataFrame(columns=['isbn']).to_excel(config.input_file, index=False)
            print(f"Created input file at: {config.input_file}")
            
    def run_single_processing_cycle(self) -> ProcessingStats:
        """Execute a single processing cycle"""
        try:
            self.last_modified_time, stats = process_isbn_file(
                self.config, self.session, self.last_modified_time
            )
            return stats
        except Exception as e:
            current_time = datetime.now().strftime("%H:%M:%S")
            print(f"[{current_time}] Error processing file: {e}")
            return ProcessingStats()
    
    def run_continuously(self) -> None:
        """Run processing continuously with optional interval"""
        self.running = True
        print("Running ISBN processor...")
        print(f"API Host: {self.config.api_host}")
        if self.config.api_key:
            print(f"Using API key: {self.config.api_key[:8]}...")
        print(f"Interval: {self.config.interval_seconds} seconds (0 = disabled)")
        print(f"File change monitoring: {'Enabled' if self.config.monitor_file_changes else 'Disabled'}")
        print()
        
        while self.running:
            self.run_single_processing_cycle()
            
            if not self.running:
                break
                
            if self.config.interval_seconds <= 0:
                time.sleep(0.1)
            else:
                # Sleep in small increments to allow for stop signal
                for _ in range(self.config.interval_seconds * 10):
                    time.sleep(0.1)
                    if not self.running:
                        break
        
        print("Processor stopped.")
    
    def stop(self) -> None:
        """Stop the processor"""
        self.running = False

class ISBNLookupApp:
    """Tkinter GUI application for ISBN lookup"""
    
    def __init__(self, root):
        self.root = root
        self.root.title("ISBN Lookup Excel Desktop UI")
        self.root.geometry("800x900")
        self.root.minsize(800, 900)
        
        self.queue = Queue()
        self.processor = None
        self.processor_thread = None
        
        self._setup_ui()
        self._setup_window_close_handler()
        self._start_queue_checking()
        
        self._apply_dpi_scaling()
    
    def _apply_dpi_scaling(self) -> None:
        """Apply DPI scaling for Windows"""
        try:
            from ctypes import windll
            windll.shcore.SetProcessDpiAwareness(1)
        except:
            pass
    
    def _setup_ui(self) -> None:
        """Set up the user interface"""
        self.root.grid_columnconfigure(1, weight=1)
        self.root.grid_columnconfigure(2, weight=0)
        self.root.grid_rowconfigure(7, weight=1)
        
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, columnspan=3, sticky="nsew")
        main_frame.grid_columnconfigure(1, weight=1)
        main_frame.grid_rowconfigure(7, weight=1)
        
        self._create_file_input_section(main_frame, row=0, label="Input File:",
                                       default="input.xlsx", var_name="input_var")
        
        self._create_file_input_section(main_frame, row=1, label="Output File:",
                                       default="output.xlsx", var_name="output_var",
                                       save_mode=True)
        
        ttk.Label(main_frame, text="API Host:").grid(row=2, column=0, sticky="w", pady=5)
        self.host_var = tk.StringVar(value=DEFAULT_API_HOST)
        ttk.Entry(main_frame, textvariable=self.host_var).grid(
            row=2, column=1, columnspan=2, sticky="ew", padx=(5, 0), pady=5
        )
        
        self._create_api_key_section(main_frame)
        
        self._create_interval_section(main_frame)
        
        self.monitor_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(main_frame, text="Monitor input file for changes",
                       variable=self.monitor_var).grid(
            row=5, column=0, columnspan=3, sticky="w", pady=5
        )
        
        self._create_control_buttons_and_status(main_frame)
        
        self._create_log_text_area(main_frame)
    
    def _create_file_input_section(
        self,
        parent,
        row: int,
        label: str,
        default: str,
        var_name: str,
        save_mode: bool = False
    ) -> None:
        """Create a file input section with browse button"""
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=5)
        
        setattr(self, var_name, tk.StringVar(value=default))
        entry = ttk.Entry(parent, textvariable=getattr(self, var_name))
        entry.grid(row=row, column=1, sticky="ew", padx=(5, 0), pady=5)
        
        browse_text = "Save As..." if save_mode else "Browse..."
        browse_command = (lambda: self._browse_file(getattr(self, var_name), save=save_mode))
        ttk.Button(parent, text=browse_text, width=10,
                  command=browse_command).grid(row=row, column=2, padx=(5, 0), pady=5)
    
    def _create_api_key_section(self, parent) -> None:
        """Create API key input with show/hide toggle"""
        ttk.Label(parent, text="API Key:").grid(row=3, column=0, sticky="w", pady=5)
        self.key_var = tk.StringVar(value=DEFAULT_API_KEY)
        self.key_entry = ttk.Entry(parent, textvariable=self.key_var, show="*")
        self.key_entry.grid(row=3, column=1, sticky="ew", padx=(5, 0), pady=5)
        
        self.show_key_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(parent, text="Show", variable=self.show_key_var,
                       command=self._toggle_key_visibility).grid(
            row=3, column=2, padx=(5, 0), pady=5, sticky="w"
        )
    
    def _create_interval_section(self, parent) -> None:
        """Create interval input section"""
        ttk.Label(parent, text="Interval (seconds):").grid(row=4, column=0, sticky="w", pady=5)
        self.interval_var = tk.StringVar(value="0")
        interval_entry = ttk.Entry(parent, textvariable=self.interval_var, width=10)
        interval_entry.grid(row=4, column=1, sticky="w", padx=(5, 0), pady=5)
        ttk.Label(parent, text="(0 = disabled)").grid(row=4, column=1, sticky="w", padx=(100, 0), pady=5)
    
    def _create_control_buttons_and_status(self, parent) -> None:
        """Create start/stop buttons and status label"""
        button_frame = ttk.Frame(parent)
        button_frame.grid(row=6, column=0, columnspan=3, pady=15, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=1)
        button_frame.grid_columnconfigure(1, weight=1)
        
        self.start_btn = ttk.Button(button_frame, text="Start Processing",
                                   command=self._start_processing)
        self.start_btn.grid(row=0, column=0, padx=(0, 5), sticky="ew")
        
        self.stop_btn = ttk.Button(button_frame, text="Stop Processing",
                                  command=self._stop_processing, state="disabled")
        self.stop_btn.grid(row=0, column=1, padx=(5, 0), sticky="ew")
        
        self.status_var = tk.StringVar(value="Ready")
        self.status_label = ttk.Label(button_frame, textvariable=self.status_var)
        self.status_label.grid(row=1, column=0, columnspan=2, pady=(10, 0))
    
    def _create_log_text_area(self, parent) -> None:
        """Create text area for processing log"""
        text_frame = ttk.LabelFrame(parent, text="Processing Log", padding="5")
        text_frame.grid(row=7, column=0, columnspan=3, sticky="nsew", pady=(10, 0))
        text_frame.grid_columnconfigure(0, weight=1)
        text_frame.grid_rowconfigure(0, weight=1)
        
        self.log_text = tk.Text(text_frame, height=15, wrap=tk.WORD)
        self.log_text.grid(row=0, column=0, sticky="nsew")
        
        text_scrollbar = ttk.Scrollbar(text_frame, orient="vertical",
                                      command=self.log_text.yview)
        text_scrollbar.grid(row=0, column=1, sticky="ns")
        self.log_text.config(yscrollcommand=text_scrollbar.set)
        
        text_hscrollbar = ttk.Scrollbar(text_frame, orient="horizontal",
                                       command=self.log_text.xview)
        text_hscrollbar.grid(row=1, column=0, columnspan=2, sticky="ew")
        self.log_text.config(xscrollcommand=text_hscrollbar.set)
    
    def _setup_window_close_handler(self) -> None:
        """Set up handler for window close event"""
        self.root.protocol("WM_DELETE_WINDOW", self._on_window_closing)
    
    def _start_queue_checking(self) -> None:
        """Start periodic checking of message queue"""
        self.root.after(100, self._check_queue)
    
    def _browse_file(self, variable: tk.StringVar, save: bool = False) -> None:
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
            variable.set(filename)
    
    def _toggle_key_visibility(self) -> None:
        """Toggle visibility of API key"""
        show = self.show_key_var.get()
        self.key_entry.config(show="" if show else "*")
    
    def _check_queue(self) -> None:
        """Check for messages from processing thread"""
        try:
            while True:
                message = self.queue.get_nowait()
                self.log_text.insert(tk.END, message)
                self.log_text.see(tk.END)
        except Empty:
            pass
        self.root.after(100, self._check_queue)
    
    def _log_message(self, message: str) -> None:
        """Add a message to the log text widget"""
        self.queue.put(message)
    
    def _start_processing(self) -> None:
        """Start ISBN processing"""
        if self.processor_thread and self.processor_thread.is_alive():
            return
        
        # Validate interval
        try:
            interval = int(self.interval_var.get())
            if interval < 0:
                self._log_message("Error: Interval must be 0 or positive\n")
                self.status_var.set("Error: Invalid interval")
                return
        except ValueError:
            self._log_message("Error: Interval must be a number\n")
            self.status_var.set("Error: Invalid interval")
            return
        
        # Update UI state
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.status_var.set("Processing...")
        self.log_text.delete(1.0, tk.END)
        
        # Create processing config
        config = ProcessingConfig(
            input_file=self.input_var.get(),
            output_file=self.output_var.get(),
            interval_seconds=interval,
            api_key=self.key_var.get() or None,
            api_host=self.host_var.get(),
            monitor_file_changes=self.monitor_var.get()
        )
        
        # Create and start processor
        self.processor = ISBNProcessor(config)
        self.processor_thread = threading.Thread(
            target=self._run_processor_with_output_redirect,
            daemon=True
        )
        self.processor_thread.start()
    
    def _run_processor_with_output_redirect(self) -> None:
        """Run processor with redirected print output to GUI"""
        import builtins
        original_print = builtins.print
        
        def custom_print(*args, **kwargs):
            text = " ".join(str(arg) for arg in args)
            if kwargs.get('end', '\n') == '\n':
                text += '\n'
            self.queue.put(text)
            original_print(*args, **kwargs)
        
        builtins.print = custom_print
        
        try:
            self.processor.run_continuously()
        finally:
            builtins.print = original_print
            self.root.after(0, self._on_processor_stop)
    
    def _on_processor_stop(self) -> None:
        """Handle processor thread completion"""
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.status_var.set("Ready")
    
    def _stop_processing(self) -> None:
        """Stop ISBN processing"""
        if self.processor:
            self.processor.stop()
            self.status_var.set("Stopping...")
    
    def _on_window_closing(self) -> None:
        """Handle window close event"""
        if self.processor:
            self.processor.stop()
        self.root.destroy()

def main() -> None:
    """Create and run the Tkinter application"""
    root = tk.Tk()
    
    # Set ttk style
    style = ttk.Style()
    
    app = ISBNLookupApp(root)
    root.update_idletasks()
    root.mainloop()

if __name__ == "__main__":
    main()