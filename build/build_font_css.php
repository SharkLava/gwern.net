<?php

echo "Building font CSS...\n";

## DEFINITIONS

/*	Font info:

	Required
	- name
	- base_path
	- format
	- entries
		- weight (key)
		- filename

	Optional
	- italic
	- font-display
	- unicode-range
 */
$bare_fields = [ "name", "base_path", "format" ];
$formats = [
	'ttf' => 'truetype',
	'otf' => 'opentype',
];

## PATHS

$static_root = __DIR__ . "/..";

$css_dir = "{$static_root}/css";
$font_dir = "{$static_root}/font";
$include_dir = "{$static_root}/include";

## ACTION

//	Read spec file.
ob_start();
require("{$font_dir}/font_spec.php");
$spec_file = ob_get_contents();
ob_end_clean();

$out = [ '@charset "UTF-8";' ];
$inlined = [ 
	'<!-- Full font CSS is loaded in footer. Here, inline only the minimal set of font CSS needed for initial screen, for speed: -->',
	'<style id="inlined-fonts">'
];

$entries_to_inline = [ ];

$spec_blocks = explode("\n\n", trim($spec_file));

foreach ($spec_blocks as $spec_block) {
	if ($spec_block[0] == '!') {
		process_command_block($spec_block);
		continue;
	}

	$entries = generate_entries($spec_block);

	$name = $entries[0]['name'];
	$pad = str_pad('', strlen($name), '*');
	$out[] = "\n" . "/**" . $pad              . "**/";
	$out[] =        "/* " . strtoupper($name) . " */";
	$out[] =        "/**" . $pad              . "**/" . "\n";

	foreach ($entries as $entry) {
		if (($entry['italic'] ?? null) !== '') {
			$constructed_rule = construct_rule($entry);
			if (should_inline($entry))
				$inlined[] = $constructed_rule;
			$out[] = $constructed_rule;
		}
		if (($entry['italic'] ?? null) !== null) {
			$constructed_rule = construct_rule($entry, true);
			if (should_inline($entry, true))
				$inlined[] = $constructed_rule;
			$out[] = $constructed_rule;
		}
	}
}

$inlined[] = '</style>';

file_put_contents("{$css_dir}/fonts-GENERATED.css", implode("\n", $out));
file_put_contents("{$include_dir}/inlined-fonts.html", implode("\n", $inlined));

## FUNCTIONS

function should_inline($candidate_entry, $italic = false) {
	global $entries_to_inline;

	foreach ($entries_to_inline as $entry) {
		$entry_matches = true;
		foreach ($entry as $key => $value) {
			if ($key == 'italic') {
				if ($italic) {
					if (   $value[0] == '+'
						&& ($candidate_entry['italic'] ?? null) === null) {
						$entry_matches = false;
					} else if ($value[0] == '-') {
						$entry_matches = false;
					}
				} else {
					if (   $value[0] == '-'
						&& ($candidate_entry['italic'] ?? null) === '') {
						$entry_matches = false;
					}
				}
			} else if (   $value != '*'
					   && @$candidate_entry[$key] != $value) {
				$entry_matches = false;
			}
		}
		if ($entry_matches) {
			return true;
		}
	}

	return false;
}

function process_command_block($command_block) {
	global $entries_to_inline;

	$command_block = explode("\n", $command_block);
	if ($command_block[0] == "!inline")
		array_push($entries_to_inline, ...(generate_entries(implode("\n", array_slice($command_block, 1)))));
}

function generate_entries($spec_block) {
	global $bare_fields;

	$entries = [ ];

	$spec = [ ];
	$spec_lines = explode("\n", trim($spec_block));
	foreach ($spec_lines as $line) {
		if ($line[0] == '`') {
			list($weight, $filename) = kv_tokenize($line);
			$entries[] = [ 'weight' => $weight, 'filename' => $filename ];	
		} else if ($line[0] == "\t") {
			list($key, $value) = kv_tokenize(ltrim($line));
			$entries[array_key_last($entries)][$key] = $value;
		} else {
			list($key, $value) = kv_tokenize($line);
			if ($key == '') {
				foreach ($bare_fields as $field) {
					if (!isset($spec[$field])) {
						$key = $field;
						break;
					}
				}
			}
			$spec[$key] = $value;
		}
	}
	foreach ($entries as &$entry) {
		$entry = array_merge($spec, $entry);
	}

	return $entries;
}

function construct_rule($entry, $italic = false) {
	global $formats;
	
	$rule   = [ ];
	$rule[] = "@font-face {";
	$rule[] = "	font-family: '" . $entry['name'] . "';";
	if ($entry['weight'] > '')
		$rule[] = "	font-weight: " . $entry['weight'] . ";";
	if (isset($entry['italic']))
		$rule[] = "	font-style: " . ($italic ? 'italic' : 'normal') . ";";
	$path = $entry['base_path'] . $entry['filename'];
	if ($italic && $entry['italic'] != '') {
		$pattern = $entry['italic'][0];
		$replacement = $entry['italic'][1];
		$path = preg_replace($pattern, $replacement, $path);
	}
	$format = $formats[$entry['format']];
	$rule[] = "	src: url('{$path}.{$entry['format']}') format('{$format}');";
	$additional_keys = [ 'font-display', 'unicode-range' ];
	foreach ($additional_keys as $key)
		if (isset($entry[$key]))
			$rule[] = "	{$key}: {$entry[$key]};";
	$rule[] = "}";

	return implode("\n", $rule);
}

function kv_tokenize($line) {
	$parts = explode("\t", $line);

	if (count($parts) == 1) {
		$key = '';
		$value = $parts[0];
	} else {
		$parts = array_filter($parts);
		$key = $parts[0];
		if ($key[0] == '`')
			$key = substr($key, 1);
		switch ($key) {
			case 'italic':
				$value = array_slice($parts, 1);
				break;
			default:
				$value = count($parts) > 1 ? array_slice($parts, 1)[0] : '';
				break;
		}
	}
	return [ $key, $value ];
}

?>