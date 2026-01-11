"use server"

import { Character } from './domain/types';
import redis from './redis'
import fs from "fs";
import path from "path";


export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export async function loadJsonFromFolder(baseDir: string): Promise<JsonObject> {
  const result: JsonObject = {};

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);

    if (entry.isDirectory()) {
      // Recursively load subfolders
      result[entry.name] = await loadJsonFromFolder(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      // Remove .json extension
      const key = path.basename(entry.name, ".json");
      const content = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as JsonValue;
      result[key] = content;
    }
  }

  return result;
}



export async function getBasicCharList(){
  const dataDir = path.join(process.cwd(), "app/characters");
  const characterData = loadJsonFromFolder(dataDir);
  return characterData
}

export async function upsertBaseCharacter(data: Character) {

  const {id, ...character} = data 

  const targetDir = path.join('app/characters', character.path);

  // Ensure the directory exists
  fs.mkdirSync(targetDir, { recursive: true });

  // Define the target file path
  const filePath = path.join(targetDir, `${character.name}.json`);

  // Write the file (pretty-printed)
  fs.writeFileSync(filePath, JSON.stringify(character, null, 2), "utf-8");

  await deleteBaseCharacter(targetDir, '')
  console.log(`✅ Created: ${filePath}`);
}

export async function deleteBaseCharacter(
  folderPath: string,
  fileName: string
) {
  const filePath = path.join('app/characters', folderPath, `${fileName}.json`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`🗑️ Deleted: ${filePath}`);
  } else {
    console.warn(`⚠️ File not found: ${filePath}`);
  }
}


export async function saveCharacter(character: Character) {
  try {
    const list: string[] = (await redis.get('charList')) ?? [];
    
    await redis.set('charList', [...list, {id: character.id, name: character.name}]);
    await redis.set(character.id, character);
  } catch (err) {
    console.error('Error saving character to Redis:', err);
    // Optionally, you could throw or return an error state here
  }
}

export async function deleteCharacter(id: string) {
  try {
    const list: {id: string, name: string}[] = (await redis.get('charList')) ?? [];
    await redis.set('charList', list.filter(el => el.id !== id));
    await redis.del(id);
  } catch (err) {
    console.error('Error deleting character from Redis:', err);
    // Optionally, you could throw or return an error state here
  }
}

export async function getCharacter(id: string) {
  try {
    const character: Character | null = await redis.get(id);
    if (character) {
      return character;
    }
    return null;
  } catch (err) {
    console.error('Error getting character from Redis:', err);
    return null;
  }
}


export async function getCharacterList(){
  try{
    const list : {id: string, name: string}[] | null = await redis.get('charList')
    if(list != null){
      return list
    }
    return []

  }catch(err){
    console.error('Error getting character list from Redis:', err);
    return []
  }
}