"use strict";

/*
 * scheming-repeating-subfields CKAN module
 *
 * Fixes for nested repeating subfields:
 *   1. Template div is removed from DOM on init (like the original JS), so
 *      placeholder inputs are never submitted with the form.
 *   2. Index replacement is scoped to the current field name, so nested
 *      REPEATING-INDEX0 placeholders in child templates are never touched.
 *   3. Bare REPEATING-INDEX1 (used in the panel heading display label) is
 *      replaced after the scoped replacements.
 *   4. Group counting uses .children() filtered by data-field, so nested
 *      panels are not counted.
 *   5. initialize() only handles THIS module's template div.  CKAN's module
 *      system handles page-load nested modules on its own.  Only dynamically
 *      added groups (via addGroup) need manual nested init.
 */
ckan.module('scheming-repeating-subfields', function ($) {

    /* ------------------------------------------------------------------ */
    /* Helpers                                                              */
    /* ------------------------------------------------------------------ */

    function replaceAll(str, search, replacement) {
        return str.split(search).join(replacement);
    }

    /**
     * Extract template HTML from the fieldset's direct child
     * [name="repeating-template"] div, remove that div from the DOM
     * (preventing placeholder inputs from being submitted), and return
     * the HTML string.
     */
    function extractAndRemoveTemplate($fieldset) {
        var $templateDiv = $fieldset.children('[name="repeating-template"]');
        if (!$templateDiv.length) {
            return '';
        }
        var html = $templateDiv.html();
        $templateDiv.remove();
        return html;
    }

    /**
     * Wire up Add and Remove handlers for a single fieldset element.
     * Safe to call multiple times (uses namespaced events).
     *
     * @param {jQuery} $fieldset
     * @param {string} field_name
     * @param {string} template  - raw HTML from the (now-removed) template div
     */
    function setupHandlers($fieldset, field_name, template) {
        $fieldset
            .find('[name="' + field_name + '-repeating-add"]').first()
            .off('click.scheming-rs')
            .on('click.scheming-rs', function (e) {
                e.preventDefault();
                addGroup($fieldset, field_name, template);
            });

        $fieldset
            .off('click.scheming-rs-remove')
            .on('click.scheming-rs-remove', '.btn-repeating-remove', function (e) {
                e.preventDefault();
                var $group = $(this).closest('.scheming-subfield-group');
                if ($group.data('field') === field_name) {
                    removeGroup($group, field_name);
                }
            });
    }

    /**
     * Clone the stored template HTML, replace index placeholders, append
     * the new panel, and manually initialise any nested
     * scheming-repeating-subfields modules inside it (CKAN won't see them
     * because they weren't in the DOM at page-load time).
     */
    function addGroup($fieldset, field_name, template) {
        if (!template) {
            return;
        }

        /* Count only DIRECT child groups for THIS field (not nested ones). */
        var $groupContainer = $fieldset
            .children('[name="' + field_name + '-subfields-group"]');

        var count = $groupContainer
            .children('.scheming-subfield-group[data-field="' + field_name + '"]')
            .length;

        /*
         * Step 1 – scoped replacement.
         *
         * Every field name in the template looks like:
         *   <field_name>-REPEATING-INDEX0-<subfield_name>
         *
         * Replacing only "<field_name>-REPEATING-INDEX0" leaves nested
         * occurrences of "REPEATING-INDEX0" (which have a different prefix)
         * completely untouched, so child templates stay valid.
         */
        var html = replaceAll(template,
            field_name + '-REPEATING-INDEX0',
            field_name + '-' + count);
        html = replaceAll(html,
            field_name + '-REPEATING-INDEX1',
            field_name + '-' + (count + 1));

        /*
         * Step 2 – bare replacement for the panel heading display label.
         *
         * The Jinja macro receives 'REPEATING-INDEX1' (bare, no prefix) as
         * its index1 argument and outputs it literally in the heading, e.g.
         * "Contributors REPEATING-INDEX1".  After the scoped replacement
         * above, no actual field names contain bare REPEATING-INDEX1 any
         * more, so this replacement only hits the visible label text (and
         * cosmetically-irrelevant labels inside nested template divs, which
         * get their own replacement when those templates are later used).
         */
        html = replaceAll(html, 'REPEATING-INDEX1', String(count + 1));

        var $newGroup = $(html);

        /* Fix data-group-index on the outer panel only. */
        $newGroup
            .filter('.scheming-subfield-group[data-field="' + field_name + '"]')
            .attr('data-group-index', count);

        $groupContainer.append($newGroup);

        /*
         * Manually initialise nested scheming-repeating-subfields modules
         * inside the new group.  CKAN won't initialise them because they
         * were not present when the page loaded.
         * Skip anything inside a [name="repeating-template"] div – those
         * are inert template containers, not live panels.
         */
        $newGroup
            .find('[data-module="scheming-repeating-subfields"]')
            .filter(function () {
                return $(this).closest('[name="repeating-template"]').length === 0;
            })
            .each(function () {
                var $nested = $(this);
                var nestedFieldName = $nested.attr('data-module-field_name');
                if (nestedFieldName) {
                    var nestedTemplate = extractAndRemoveTemplate($nested);
                    setupHandlers($nested, nestedFieldName, nestedTemplate);
                }
            });

        $newGroup.hide().show(100);
        $newGroup.find('input').first().focus();
        $fieldset.trigger('scheming.subfield-group-init');
    }

    /**
     * Hide a group's fields, wipe their HTML so no inputs are submitted,
     * and show the "removed" notice.
     */
    function removeGroup($group, field_name) {
        if ($group.data('removed')) {
            return;
        }
        $group.data('removed', true);

        var $content = $group.find('.panel-body.fields-content[data-field-name="' + field_name + '"]');
        var $button  = $group.find('a[name="' + field_name + '-repeating-remove"]');
        var $notice  = $group.find('.panel-body.fields-removed-notice[data-field-name="' + field_name + '"]');

        $button.hide();
        $notice.show(100);
        $content.hide(100, function () {
            $content.html('');
        });
    }

    /* ------------------------------------------------------------------ */
    /* CKAN module interface                                                */
    /* ------------------------------------------------------------------ */

    return {
        options: {
            field_name: null
        },

        initialize: function () {
            var field_name = this.options.field_name;
            var $fieldset  = this.el;

            /*
             * Extract and remove THIS module's template div only.
             *
             * Do NOT loop over nested [data-module="scheming-repeating-subfields"]
             * elements here.  CKAN's module system will call initialize() on
             * each of them in turn.  If we extracted their template divs here
             * first, their own initialize() calls would find nothing and their
             * Add buttons would be permanently broken.
             *
             * Nested modules inside dynamically added groups (created by
             * addGroup) are the only ones that need manual init, because CKAN
             * never sees those – they're handled inside addGroup() above.
             */
            var template = extractAndRemoveTemplate($fieldset);

            setupHandlers($fieldset, field_name, template);
        }
    };
});

