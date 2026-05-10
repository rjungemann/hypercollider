// fixture_loader.sc - Fixture loader for differential testing
// Part of Phase P0: Harness bootstrap

ScscmFixtureLoader : Object {
	var <>fixtureDirs, <>extensions, <>excluded, <>loadedFixtures;

	// Constructor
	*new { |fixtureDirs = ["tests/fixtures/scscm"], extensions = [".scscm"], excluded = []|
		^super.new.init(fixtureDirs, extensions, excluded)
	}

	init { |fixtureDirs, extensions, excluded|
		this.fixtureDirs = fixtureDirs;
		this.extensions = extensions;
		this.excluded = excluded;
		this.loadedFixtures = List.new;
		^this
	}

	// Load all fixtures
	loadAll { 
		this.loadedFixtures = List.new;
		
		this.fixtureDirs.do({ |dirPath|
			var dir = Directory(dirPath);
			if (dir.exists) {
				dir.entries.do({ |entry|
					if (entry.isDirectory) {
						// Recursively load from subdirectories
						var subDir = Directory(entry.fullPath);
						subDir.entries.do({ |subEntry|
							this.loadEntry(subEntry, dirPath)
						})
					} {
						this.loadEntry(entry, dirPath)
					}
				})
			}
		})
		
		^this.loadedFixtures
	}

	// Load a single entry
	loadEntry { |entry, baseDir|
		var fullPath = entry.fullPath;
		
		// Skip excluded files
		this.excluded.do({ |pattern|
			if (fullPath.includes(pattern)) { ^this }
		});
		
		// Check extension
		var matched = false;
		this.extensions.do({ |ext|
			if (fullPath.endsWith(ext)) { matched = true }
		});
		
		if (matched.not) { ^this };
		
		// Read file
		var file = File(fullPath, "r");
		if (file.isOpen) {
			var source = file.readAllString;
			file.close;
			
			// Calculate relative path
			var relPath = fullPath.replace(baseDir, "").trim($/);
			
			var fixture = ScscmFixture.new(fullPath, relPath, source);
			this.loadedFixtures = this.loadedFixtures.add(fixture)
		}
	}

	// Load specific fixtures by name
	loadByName { |name|
		^this.loadedFixtures.select({ |f| f.relPath == name })
	}

	// Load fixtures matching pattern
	loadMatching { |pattern|
		^this.loadedFixtures.select({ |f| f.relPath.includes(pattern) })
	}

	// Get all loaded fixtures
	getFixtures { 
		^this.loadedFixtures
	}

	// Filter fixtures by tag (from comments in the file)
	loadByTag { |tag|
		^this.loadedFixtures.select({ |f| f.hasTag(tag) })
	}

	// Reset loaded fixtures
	reset { 
		this.loadedFixtures = List.new;
		^this
	}
}

// Fixture representation
ScscmFixture : Object {
	var <>fullPath, <>relPath, <>source, <>tags, <>parsedTags;

	*new { |fullPath, relPath, source|
		^super.new.init(fullPath, relPath, source)
	}

	init { |fullPath, relPath, source|
		this.fullPath = fullPath;
		this.relPath = relPath;
		this.source = source;
		this.tags = List.new;
		this.parsedTags = false;
		^this
	}

	// Parse tags from source comments
	parseTags { 
		if (this.parsedTags) { ^this };
		
		var lines = this.source.split($\n);
		lines.do({ |line|
			var trimmed = line.trim;
			if (trimmed.beginsWith(";;") and: { trimmed.includes("@tag") }) {
				// Parse tag from comment like ;; @tag core
				var tagStart = trimmed.find("@tag");
				if (tagStart.notNil) {
					var tagPart = trimmed.drop(tagStart + 4).trim;
					var tagEnd = tagPart.find($\s);
					var tag = (tagEnd.notNil ? tagPart.copyRange(0, tagEnd - 1) : tagPart);
					if (tag.notEmpty) {
						this.tags = this.tags.add(tag)
					}
				}
			}
		});
		
		this.parsedTags = true;
		^this
	}

	// Check if fixture has a specific tag
	hasTag { |tag|
		this.parseTags;
		^this.tags.includes(tag)
	}

	// Get all tags
	getTags { 
		this.parseTags;
		^this.tags
	}

	asString { 
		^"Fixture({this.relPath})"
	}
}

// Fixture group for organizing tests
ScscmFixtureGroup : Object {
	var <>name, <>fixtures;

	*new { |name, fixtures = []|
		^super.new.copy(name: name, fixtures: fixtures)
	}

	add { |fixture|
		^this.copy(fixtures: this.fixtures.add(fixture))
	}

	addAll { |newFixtures|
		^this.copy(fixtures: this.fixtures ++ newFixtures)
	}

	size { 
		^this.fixtures.size
	}

	asString { 
		^"FixtureGroup({this.name}, {this.size} fixtures)"
	}
}
