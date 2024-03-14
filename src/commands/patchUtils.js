// patchUtils.js

//
// Convert the mail body to a patch file.
// Return [success, patchBody]
// success: true if the conversion is successful.
// patchBody: the content in patch format if success is true, otherwise it might not be in patch format.
//
function convertToPatch(bodyText) {
  const PatchStateStart = 0;
  const PatchStateFileHeader = 1;
  const PatchStateHunkHeader = 2;
  const PatchStateHunk = 3;
  const PatchStateHunkEnd = 4;
  const PatchStateEnd = 5;

  // diff --git a/filepath_1 b/filepath_2
  // This regular expression matches the header line of a git diff output.
  // It matches lines that start with "diff --git a/" followed by any characters, a space, "b/", and any characters.
  // The parentheses create capture groups for the paths of the "a" and "b" files.
  const regexPatchFileHeader = /^diff\s+--git\s+a(\/.*)\s+b(\/.*)$/;

  //@@ -347,7 +347,8 @@ Field(GNVS,AnyAcc,Lock,Preserve)
  //@@ -1 +1,3 @@ xx
  // It matches the hunk headers and capture the line numbers.
  const regexPatchHunkAsciiHeader = /^@@\s+-(?:\d+,)?(\d+)\s+\+(?:\d+,)?(\d+)\s+@@.*$/;

  //delta ####
  //literal ####
  const regexPatchHunkBinarySubHeader = /^(delta|literal)\s+[0-9]+\s*$/;

  const regexPatchHunkBinary = /^[a-zA-Z]\S+$/;

  let patchBody = "";
  let addedLinesInHunk = 0;
  let deletedLinesInHunk = 0;
  let asciiHunk = false;
  let state = PatchStateStart;
  let success = true;
  let filePath = null;

  for (const line of bodyText.replaceAll("\u00A0", " ").split(/\r\n|\n/)) {
    let unixEol = true;
    let m;

    if ((state == PatchStateStart || state == PatchStateHunkEnd) && (m = line.match(regexPatchFileHeader))) {
      // meet "diff --git"
      state = PatchStateFileHeader;
      unixEol = true;

      console.assert(m[1].toString() == m[2].toString(), "file path mismatch!");
      success = success && m[1].toString() == m[2].toString();

      filePath = m[1].toString();
    } else if (
      (state == PatchStateFileHeader || state == PatchStateHunkEnd) &&
      ((m = line.match(regexPatchHunkAsciiHeader)) || line == "GIT binary patch")
    ) {
      // meet "@@ ..." or "GIT binary patch"
      unixEol = true;
      state = PatchStateHunkHeader;

      if (m) {
        asciiHunk = true;
        deletedLinesInHunk = parseInt(m[1].toString());
        addedLinesInHunk = parseInt(m[2].toString());
      } else {
        asciiHunk = false;
      }
    } else if (
      (state == PatchStateHunkHeader || state == PatchStateHunkEnd) &&
      line.match(regexPatchHunkBinarySubHeader)
    ) {
      // meet "delta ###" or "literal ###"
      console.assert(!asciiHunk, "Binary patch mixed with ascii patch!");
      success = success && !asciiHunk;

      state = PatchStateHunkHeader;
      unixEol = true;
    } else if (state == PatchStateHunkHeader || state == PatchStateHunk) {
      state = PatchStateHunk;
      if (asciiHunk) {
        // meet " xxyy", "+xxyy" "-xxyy" or "\ No newline at end of file"
        unixEol = filePath.endsWith(".sh");

        if (line != "\\ No newline at end of file" && line != "") {
          if (line[0] == " " || line[0] == "+") {
            addedLinesInHunk--;
          }
          if (line[0] == " " || line[0] == "-") {
            deletedLinesInHunk--;
          }
        }

        if (addedLinesInHunk == 0 && deletedLinesInHunk == 0) {
          state = PatchStateHunkEnd;
        }
        success = success && addedLinesInHunk >= 0 && deletedLinesInHunk >= 0;
      } else {
        unixEol = true;

        if (!line.match(regexPatchHunkBinary)) {
          state = PatchStateHunkEnd;
        }
      }
    } else if (state == PatchStateHunkEnd && line == "-- ") {
      unixEol = true;
      state = PatchStateEnd;
    }

    // Seems Outlook has a bug which adds extra empty line in the hunk
    // when the previous line is a long while space line.
    if (state == PatchStateHunk || state == PatchStateHunkEnd) {
      if (asciiHunk && line == "") {
        continue;
      }
    }
    //
    // Somehow Outlook uses non-break space (\u00A0) to replace ascii space.
    // Convert it back to ascii space.
    //
    patchBody += line.replaceAll("\u00A0", " ") + (unixEol ? "\n" : "\r\n");
  }

  if (state != PatchStateEnd) {
    success = false;
  }
  return [success, patchBody];
}

// Convert "[EDK2] [Patch V2 2/5] xxx." to "0002-xxx.patch"
// Convert "[EDK2] [Patch V2] xxx" to "0001-xxx.patch"
function getPatchFileName(subject, success) {
  const regexSubject = /(?:\[edk2-devel\]\s*)?\[PATCH\s*(?:V\d+\s+)?(?:(\d+)\/\d+)?\]\s*(.*?)[.\s]*$/i;
  let mailSubject = subject;
  // Extract the patch index and patch title
  let match = mailSubject.match(regexSubject);
  if (match) {
    let patchIndex = parseInt(match[1]) || 1;
    mailSubject = `${patchIndex.toString().padStart(4, "0")}-${match[2]}`;
  }
  mailSubject = mailSubject
    .replace(/[^\x00-\x7F]/g, " ") // Remove non-ascii characters
    .replace(/[\\\/\*\|\"\<\>\:\#\?]/g, " ") // Remove special characters, such as \ / * | " < > : # ?
    .replace(/ +/g, "-"); // Replace spaces with -

  if (!success) {
    mailSubject += ".warning";
  }
  return `${mailSubject}.patch`;
}

module.exports = {
  convertToPatch,
  getPatchFileName,
};
