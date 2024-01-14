#!/bin/bash

set -e

help() {
    echo "Usage: $0 [major|minor|patch]"
    echo
    echo 'Increases the project version (by default, just by the patch version),'
    echo 'commits the change, and creates a corresponding tag.'
    echo
    echo 'Requires that the working tree be clean.'
}

if [[ "$*" == '--help' ]]; then
    help
    exit
fi

if (( $# > 1 )); then
    help >&2
    exit 1
fi

step=$1

if [[ ! $step ]]; then
    step=patch
fi

# If changes have been made to the working tree
if ! git diff --quiet; then
    echo >&2 'Your working tree is not clean! Aborting bump.'
    exit 1
fi

current=$(cat version)

if [[ ! $current =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    echo >&2 "Current version does not match pattern: \"$current\""
    exit 1
fi

major=${BASH_REMATCH[1]}
minor=${BASH_REMATCH[2]}
patch=${BASH_REMATCH[3]}

case $step in
    major)
        major=$((major + 1))
        minor=0
        patch=0
        ;;
    minor)
        minor=$((minor + 1))
        patch=0
        ;;
    patch)
        patch=$((patch + 1))
        ;;
    *)
        echo >&2 "Invalid argument: \"$step\""
        echo >&2
        help >&2
        exit 1
        ;;
esac

new="$major.$minor.$patch"

echo "$new" > version

git add version
git commit -m "Bump to $new"
git tag "$new"

echo "Successfully bumped to $new"
