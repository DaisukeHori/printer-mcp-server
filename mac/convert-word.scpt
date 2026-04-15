-- convert-word.scpt
-- Usage: osascript convert-word.scpt /path/to/input.docx /path/to/output.pdf
on run argv
    set inputPath to POSIX file (item 1 of argv) as alias
    set outputPath to item 2 of argv

    tell application "Microsoft Word"
        -- Don't bring window to front (headless-friendly)
        set displayAlerts to 0

        open inputPath

        -- Wait for document to fully load
        repeat while not (active document is not missing value)
            delay 0.5
        end repeat

        set activeDoc to active document

        -- Save as PDF using Word's native export
        save as activeDoc file name outputPath file format format PDF

        close activeDoc saving no

        -- Reset alerts
        set displayAlerts to -1
    end tell
end run
