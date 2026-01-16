# Smart Connections MCP Tools - Testing Instructions for Claude

This document provides step-by-step instructions for Claude (or any AI assistant) to test the Smart Connections MCP tools and validate results against the Smart Connections UI.

## Prerequisites

Before testing, verify:
1. Smart Connections plugin is installed and embeddings are generated
2. MCP plugin is enabled with Smart Connections tools enabled
3. Claude Desktop is connected to the MCP server

## Test Procedure

### Test 1: Verify Tool Availability and Basic Stats

**Step 1.1**: List all available MCP tools and confirm these 6 Smart Connections tools exist:
- `smart_similar_notes`
- `smart_connection_graph`
- `smart_search_notes`
- `smart_embedding_neighbors`
- `smart_note_content`
- `smart_stats`

**Step 1.2**: Call `smart_stats` to get baseline information:
```json
{
  "name": "smart_stats"
}
```

**Record**:
- Total notes: _____
- Total blocks: _____
- Embedding dimension: _____
- Model key: _____

**User Action**: In Obsidian, open Smart Connections panel and verify:
- Does the note count match?
- Does it use the same model?

---

### Test 2: Find Similar Notes (Core Functionality)

**Step 2.1**: User picks a test note. User should tell Claude:
> "Test similar notes using: [YourNoteName.md]"

**Step 2.2**: Claude calls `smart_similar_notes`:
```json
{
  "name": "smart_similar_notes",
  "arguments": {
    "notePath": "[USER_PROVIDED_PATH]",
    "limit": 10,
    "threshold": 0.5
  }
}
```

**Step 2.3**: Claude displays results in a table:
```
Rank | Note Path                  | Similarity | Blocks
-----|----------------------------|------------|------------------
1    | example.md                 | 0.92       | #intro, #summary
2    | related.md                 | 0.85       | #chapter-1
...
```

**User Action**: In Smart Connections panel:
1. Click on the same note
2. View the "Connections" or "Similar Notes" section
3. Compare the top 5-10 results

**Validation Questions**:
- Do the same notes appear in both lists?
- Are similarity scores roughly comparable (±0.05)?
- Is the ranking order similar?
- Are there any notes in UI that are missing from MCP results, or vice versa?

---

### Test 3: Search by Keywords

**Step 3.1**: User picks a search term. User should tell Claude:
> "Search for notes about: [keyword or phrase]"

**Step 3.2**: Claude calls `smart_search_notes`:
```json
{
  "name": "smart_search_notes",
  "arguments": {
    "query": "[USER_PROVIDED_QUERY]"
  }
}
```

**Step 3.3**: Claude lists all matching notes with their blocks

**User Action**: In Smart Connections:
1. Use the search feature with the same query
2. Compare results

**Validation**:
- Do both find the same notes?
- Are the block references similar?

---

### Test 4: Build Connection Graph

**Step 4.1**: User picks a starting note. User should tell Claude:
> "Build a connection graph starting from: [YourNoteName.md] with depth 2"

**Step 4.2**: Claude calls `smart_connection_graph`:
```json
{
  "name": "smart_connection_graph",
  "arguments": {
    "notePath": "[USER_PROVIDED_PATH]",
    "depth": 2,
    "threshold": 0.6,
    "maxPerLevel": 5
  }
}
```

**Step 4.3**: Claude visualizes the graph structure:
```
Level 0:
  └─ StartNote.md

Level 1 (from StartNote.md):
  ├─ Related1.md (similarity: 0.85)
  ├─ Related2.md (similarity: 0.78)
  └─ Related3.md (similarity: 0.72)

Level 2 (from Related1.md):
  ├─ DeepRelated1.md (similarity: 0.81)
  └─ DeepRelated2.md (similarity: 0.75)

Level 2 (from Related2.md):
  └─ DeepRelated3.md (similarity: 0.70)
```

**User Action**: In Smart Connections:
1. Open the graph view for the same note
2. Expand connections to 2 levels
3. Compare the connections shown

**Validation**:
- Are the same notes connected?
- Do similarity scores match?
- Is the graph structure similar?

---

### Test 5: Retrieve Note Content with Metadata

**Step 5.1**: User picks a test note. User should tell Claude:
> "Get the content and metadata for: [YourNoteName.md]"

**Step 5.2**: Claude calls `smart_note_content`:
```json
{
  "name": "smart_note_content",
  "arguments": {
    "notePath": "[USER_PROVIDED_PATH]"
  }
}
```

**Step 5.3**: Claude reports:
- Path: _____
- Has embedding: true/false
- Number of blocks: _____
- Block IDs: [list]
- Content preview (first 200 chars)

**User Action**: In Smart Connections:
1. Check if the note has embeddings (should show up in searches)
2. View the note's structure

**Validation**:
- Does hasEmbedding match what you see in UI?
- Do block IDs/headings match the actual note structure?
- Is content accurate?

---

### Test 6: Test with Custom Embedding Vector

**Step 6.1**: Claude gets an embedding from an existing note first:
```json
{
  "name": "smart_note_content",
  "arguments": {
    "notePath": "[ANY_NOTE_PATH]"
  }
}
```

**Note**: This doesn't return the embedding, so we'll use a hypothetical one.

**Step 6.2**: Claude calls `smart_embedding_neighbors` with a test vector:
```json
{
  "name": "smart_embedding_neighbors",
  "arguments": {
    "embedding": [/* 384 numbers between -1 and 1 */],
    "limit": 5,
    "threshold": 0.5
  }
}
```

**Expected**: Should return similar behavior to `smart_similar_notes` but with custom vector.

**Validation**:
- Tool should accept the vector
- Should return reasonable neighbors
- Should reject if dimension ≠ 384

---

### Test 7: Edge Cases and Error Handling

**Test 7.1 - Non-existent Note**:
```json
{
  "name": "smart_similar_notes",
  "arguments": {
    "notePath": "ThisNoteDoesNotExist.md",
    "limit": 10
  }
}
```
**Expected**: Clear error message saying note not found or has no embeddings

---

**Test 7.2 - Invalid Parameters**:
```json
{
  "name": "smart_similar_notes",
  "arguments": {
    "notePath": "SomeNote.md",
    "limit": -5,
    "threshold": 1.5
  }
}
```
**Expected**: Validation error for negative limit or threshold > 1

---

**Test 7.3 - Empty Search Query**:
```json
{
  "name": "smart_search_notes",
  "arguments": {
    "query": ""
  }
}
```
**Expected**: Error or no results

---

**Test 7.4 - Very High Threshold**:
```json
{
  "name": "smart_similar_notes",
  "arguments": {
    "notePath": "SomeNote.md",
    "limit": 10,
    "threshold": 0.99
  }
}
```
**Expected**: Very few or zero results (only extremely similar notes)

---

### Test 8: Performance Check

**Step 8.1**: Claude calls `smart_stats` and notes the response time

**Step 8.2**: Claude calls `smart_similar_notes` for the same note twice in a row

**Step 8.3**: Compare response times:
- First call (cache miss): Should be slower (~100-500ms)
- Second call (cache hit): Should be fast (<10ms)

**User reports**:
- First call time: _____ms
- Second call time: _____ms
- Cache working properly? Yes/No

---

### Test 9: Cross-Validation with Multiple Notes

**Step 9.1**: User provides 3 diverse notes. User should tell Claude:
> "Test these 3 notes: [Note1.md], [Note2.md], [Note3.md]"

**Step 9.2**: For each note, Claude:
1. Finds similar notes using MCP
2. Asks user to verify top 3 results in Smart Connections UI

**Step 9.3**: Claude creates a comparison table:

```
Test Note    | MCP Top 3                      | UI Top 3                  | Match?
-------------|--------------------------------|---------------------------|--------
Note1.md     | A.md, B.md, C.md              | A.md, B.md, C.md          | ✓
Note2.md     | D.md, E.md, F.md              | D.md, F.md, E.md          | ~
Note3.md     | G.md, H.md, I.md              | G.md, X.md, H.md          | ✗
```

**Analysis**:
- ✓ = Perfect match (same notes, same order)
- ~ = Partial match (same notes, different order)
- ✗ = Mismatch (different notes)

If there are mismatches, investigate:
- Is the cache stale? (Try manual reload in settings)
- Are embeddings up to date?
- Are threshold settings different?

---

## Test Report Template

After running all tests, Claude should generate a report:

```markdown
# Smart Connections MCP Tools Test Report

**Date**: [DATE]
**Vault**: [VAULT_NAME]
**Plugin Version**: [VERSION]
**Smart Connections Version**: [VERSION]

## Summary
- Total tests: 9
- Tests passed: __/9
- Tests failed: __/9
- Tests with warnings: __/9

## Detailed Results

### Test 1: Tool Availability ✓/✗
- All 6 tools available: Yes/No
- Stats match UI: Yes/No
- Notes: [any observations]

### Test 2: Similar Notes ✓/✗
- Top results match UI: Yes/No/Partial
- Similarity scores accurate: Yes/No
- Notes: [any observations]

### Test 3: Keyword Search ✓/✗
- Results match UI: Yes/No
- Notes: [any observations]

### Test 4: Connection Graph ✓/✗
- Graph structure matches: Yes/No
- Notes: [any observations]

### Test 5: Note Content ✓/✗
- Metadata accurate: Yes/No
- Notes: [any observations]

### Test 6: Custom Embeddings ✓/✗
- Vector handling correct: Yes/No
- Notes: [any observations]

### Test 7: Error Handling ✓/✗
- Errors handled gracefully: Yes/No
- Notes: [any observations]

### Test 8: Performance ✓/✗
- Cache working: Yes/No
- Response times acceptable: Yes/No
- Notes: [any observations]

### Test 9: Cross-Validation ✓/✗
- Match rate: __/3
- Notes: [any observations]

## Issues Found
1. [List any issues or discrepancies]
2. [...]

## Recommendations
1. [Any suggestions for improvement]
2. [...]
```

---

## Quick Test Checklist

For rapid validation, run this minimal test:

1. ☐ Call `smart_stats` - verify numbers make sense
2. ☐ Pick one note and call `smart_similar_notes`
3. ☐ Check top 3 results against Smart Connections UI
4. ☐ Test one error case (non-existent note)
5. ☐ Verify cache performance (call same query twice)

If all 5 pass → ✅ Tools are working correctly
If any fail → 🔍 Run full test suite above
