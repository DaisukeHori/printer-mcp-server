-- convert-excel.scpt
-- Usage: osascript convert-excel.scpt /path/to/input.xlsx /path/to/output.pdf
on run argv
    set inputPath to POSIX file (item 1 of argv) as alias
    set outputPath to item 2 of argv

    tell application "Microsoft Excel"
        set display alerts to false

        open inputPath

        -- Wait for workbook
        repeat while not (active workbook is not missing value)
            delay 0.5
        end repeat

        set activeWb to active workbook

        -- Save as PDF (all sheets)
        save activeWb in outputPath as PDF file format

        close activeWb saving no

        set display alerts to true
    end tell
end run
