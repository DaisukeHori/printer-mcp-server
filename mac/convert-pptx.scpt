-- convert-pptx.scpt
-- Usage: osascript convert-pptx.scpt /path/to/input.pptx /path/to/output.pdf
on run argv
    set inputPath to POSIX file (item 1 of argv) as alias
    set outputPath to item 2 of argv

    tell application "Microsoft PowerPoint"
        set display alerts to false

        open inputPath

        -- Wait for presentation
        repeat while not (active presentation is not missing value)
            delay 0.5
        end repeat

        set activePres to active presentation

        -- Save as PDF
        save activePres in outputPath as save as PDF

        close activePres saving no

        set display alerts to true
    end tell
end run
